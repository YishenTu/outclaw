import { type EffortLevel, isEffortLevel } from "../../common/commands.ts";
import type {
	BrowserCronHistoryCursor,
	BrowserLatencyResponse,
	ImageMediaType,
	SessionCursor,
} from "../../common/protocol.ts";
import { validateSessionSearchQuery } from "../application/session-search-query.ts";
import type { BrowserApi as BrowserApiImpl } from "../browser/create-browser-api.ts";
import { FileConflictError } from "../browser/files/write-browser-file.ts";

// Method signatures are owned by `runtime/browser/create-browser-api.ts` so
// the router cannot drift from the implementation. A small set of methods are
// always invoked without a guard; everything else is optional so partial test
// mocks still satisfy the type.
type AlwaysRequired =
	| "getAgentTerminalCwd"
	| "initGitRepo"
	| "listAgentCron"
	| "listAgentTree"
	| "listAgents"
	| "readAgentFile"
	| "readConfigFile"
	| "readGitCommit"
	| "readGitCommitStats"
	| "readGitDiff"
	| "readGitStatus"
	| "setAgentCronEnabled"
	| "writeConfigFile";

export type BrowserApi = Pick<BrowserApiImpl, AlwaysRequired> &
	Partial<Omit<BrowserApiImpl, AlwaysRequired>>;

export async function handleBrowserApiRequest(
	req: Request,
	url: URL,
	browserApi: BrowserApi | undefined,
	context: { browserClientId?: string } = {},
): Promise<Response> {
	if (url.pathname === "/api/latency") {
		if (req.method !== "GET") {
			return jsonError("Method not allowed", 405);
		}
		return Response.json(
			{
				ok: true,
				serverTimeMs: Date.now(),
			} satisfies BrowserLatencyResponse,
			{
				headers: {
					"cache-control": "no-store",
				},
			},
		);
	}

	if (!browserApi) {
		return jsonError("Browser API is not configured", 404);
	}

	try {
		if (url.pathname === "/api/agents") {
			return Response.json(
				browserApi.listAgents({ browserClientId: context.browserClientId }),
			);
		}

		if (url.pathname === "/api/config") {
			if (req.method === "PATCH") {
				const body = (await req.json().catch(() => undefined)) as
					| { document?: Record<string, unknown> }
					| undefined;
				if (!body?.document) {
					return jsonError("Missing config document", 400);
				}
				return Response.json(await browserApi.writeConfigFile(body.document));
			}
			return Response.json(await browserApi.readConfigFile());
		}

		if (url.pathname === "/api/git/status") {
			return Response.json(
				await browserApi.readGitStatus(readRepositoryIdParams(url)),
			);
		}

		if (url.pathname === "/api/git/history") {
			if (!browserApi.readGitHistory) {
				return jsonError("Git history API is not configured", 404);
			}
			const historyParams = readGitHistoryParams(url);
			if (historyParams.status === "invalid") {
				return jsonError(historyParams.message, 400);
			}
			return Response.json(
				await browserApi.readGitHistory(historyParams.value),
			);
		}

		if (url.pathname === "/api/git/init") {
			if (req.method !== "POST") {
				return jsonError("Method not allowed", 405);
			}
			return Response.json(
				await browserApi.initGitRepo(readRepositoryIdParams(url)),
			);
		}

		if (url.pathname === "/api/git/diff") {
			const path = url.searchParams.get("path");
			if (!path) {
				return jsonError("Missing path query parameter", 400);
			}
			return Response.json(
				await browserApi.readGitDiff(path, readRepositoryIdParams(url)),
			);
		}

		if (url.pathname === "/api/git/commit") {
			const sha = url.searchParams.get("sha");
			if (!sha) {
				return jsonError("Missing sha query parameter", 400);
			}
			return Response.json(
				await browserApi.readGitCommit(sha, readRepositoryIdParams(url)),
			);
		}

		if (url.pathname === "/api/git/commit/stats") {
			const sha = url.searchParams.get("sha");
			if (!sha) {
				return jsonError("Missing sha query parameter", 400);
			}
			return Response.json(
				await browserApi.readGitCommitStats(sha, readRepositoryIdParams(url)),
			);
		}

		if (url.pathname === "/api/images") {
			if (req.method !== "POST") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.uploadImages) {
				return jsonError("Image upload is not configured", 404);
			}

			const images = await readUploadedImages(req);
			return Response.json({
				images: await browserApi.uploadImages(images),
			});
		}

		const inboxMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/inbox(?:\/(archive|note|restore))?$/,
		);
		if (inboxMatch) {
			const [, encodedAgentId, action] = inboxMatch;
			const agentId = decodeURIComponent(encodedAgentId ?? "");

			if (!action) {
				if (req.method !== "GET") {
					return jsonError("Method not allowed", 405);
				}
				if (!browserApi.listAgentInbox) {
					return jsonError("Inbox API is not configured", 404);
				}
				return Response.json(await browserApi.listAgentInbox(agentId));
			}

			if (req.method !== "POST") {
				return jsonError("Method not allowed", 405);
			}

			if (action === "archive") {
				if (!browserApi.archiveAgentInboxItem) {
					return jsonError("Inbox API is not configured", 404);
				}
				const body = (await req.json().catch(() => undefined)) as
					| { path?: unknown }
					| undefined;
				if (typeof body?.path !== "string") {
					return jsonError("Missing inbox path", 400);
				}
				return Response.json(
					await browserApi.archiveAgentInboxItem(agentId, body.path),
				);
			}

			if (action === "note") {
				if (!browserApi.createAgentInboxNote) {
					return jsonError("Inbox API is not configured", 404);
				}
				const body = (await req.json().catch(() => undefined)) as
					| { body?: unknown; title?: unknown }
					| undefined;
				const noteBody = body?.body;
				const title = body?.title;
				if (
					typeof noteBody !== "string" ||
					(title !== undefined && typeof title !== "string")
				) {
					return jsonError("Missing inbox note content", 400);
				}
				return Response.json(
					await browserApi.createAgentInboxNote(agentId, {
						body: noteBody,
						title,
					}),
				);
			}

			if (!browserApi.restoreAgentInboxItem) {
				return jsonError("Inbox API is not configured", 404);
			}
			const body = (await req.json().catch(() => undefined)) as
				| { archivedPath?: unknown; originalPath?: unknown }
				| undefined;
			if (
				typeof body?.archivedPath !== "string" ||
				typeof body.originalPath !== "string"
			) {
				return jsonError("Missing inbox restore path", 400);
			}
			return Response.json(
				await browserApi.restoreAgentInboxItem(
					agentId,
					body.archivedPath,
					body.originalPath,
				),
			);
		}

		const cronHistoryMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/cron\/history$/,
		);
		if (cronHistoryMatch) {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.listAgentCronHistory) {
				return jsonError("Cron history API is not configured", 404);
			}
			const agentId = decodeURIComponent(cronHistoryMatch[1] ?? "");
			const jobName = url.searchParams.get("name");
			if (!jobName) {
				return jsonError("Missing cron job name", 400);
			}
			const limitParam = url.searchParams.get("limit");
			const beforeRanAtParam = url.searchParams.get("beforeRanAt");
			const beforeProviderId = url.searchParams.get("beforeProviderId");
			const beforeSessionId = url.searchParams.get("beforeSessionId");
			const limit = limitParam ? Number.parseInt(limitParam, 10) : 1;
			if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
				return jsonError("Invalid limit", 400);
			}
			let before: BrowserCronHistoryCursor | undefined;
			if (
				beforeRanAtParam !== null ||
				beforeProviderId !== null ||
				beforeSessionId !== null
			) {
				const ranAt =
					beforeRanAtParam === null
						? Number.NaN
						: Number.parseInt(beforeRanAtParam, 10);
				if (
					!Number.isInteger(ranAt) ||
					ranAt < 0 ||
					!beforeProviderId ||
					!beforeSessionId
				) {
					return jsonError("Invalid before cursor", 400);
				}
				before = {
					ranAt,
					providerId: beforeProviderId,
					sessionId: beforeSessionId,
				};
			}
			return Response.json(
				await browserApi.listAgentCronHistory(agentId, {
					jobName,
					limit,
					before,
				}),
			);
		}

		if (url.pathname === "/api/coding/models") {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.listCodingModels) {
				return jsonError("Coding model catalog is not configured", 404);
			}
			return Response.json(await browserApi.listCodingModels());
		}

		if (url.pathname === "/api/coding/folder-picker") {
			if (req.method !== "POST") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.pickCodingRepositoryFolder) {
				return jsonError("Coding folder picker is not configured", 404);
			}
			return Response.json(await browserApi.pickCodingRepositoryFolder());
		}

		if (url.pathname === "/api/coding/repositories/clone") {
			if (req.method !== "POST") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.cloneCodingRepository) {
				return jsonError("Coding repository API is not configured", 404);
			}
			const body = (await req.json().catch(() => undefined)) as
				| {
						displayName?: unknown;
						parentDir?: unknown;
						remoteUrl?: unknown;
				  }
				| undefined;
			if (
				typeof body?.remoteUrl !== "string" ||
				body.remoteUrl.trim() === "" ||
				typeof body.parentDir !== "string" ||
				body.parentDir.trim() === "" ||
				(body.displayName !== undefined && typeof body.displayName !== "string")
			) {
				return jsonError("Invalid coding clone request", 400);
			}
			return Response.json(
				await browserApi.cloneCodingRepository({
					remoteUrl: body.remoteUrl,
					parentDir: body.parentDir,
					...(body.displayName !== undefined
						? { displayName: body.displayName }
						: {}),
				}),
			);
		}

		const codingRepositoriesMatch = url.pathname.match(
			/^\/api\/coding\/repositories(?:\/([^/]+)(?:\/(archive|restore|tree|workspace-files|files|skills))?)?$/,
		);
		if (codingRepositoriesMatch) {
			const [, encodedRepositoryId, action] = codingRepositoriesMatch;
			if (!encodedRepositoryId) {
				if (req.method === "GET") {
					if (!browserApi.listCodingRepositories) {
						return jsonError("Coding repository API is not configured", 404);
					}
					return Response.json(
						await browserApi.listCodingRepositories({
							includeArchived:
								url.searchParams.get("includeArchived") === "true",
						}),
					);
				}
				if (req.method === "POST") {
					if (!browserApi.registerCodingRepository) {
						return jsonError("Coding repository API is not configured", 404);
					}
					const body = (await req.json().catch(() => undefined)) as
						| {
								displayName?: unknown;
								remoteUrl?: unknown;
								rootCwd?: unknown;
								source?: unknown;
						  }
						| undefined;
					if (
						typeof body?.rootCwd !== "string" ||
						body.rootCwd.trim() === "" ||
						(body.displayName !== undefined &&
							typeof body.displayName !== "string") ||
						(body.remoteUrl !== undefined &&
							typeof body.remoteUrl !== "string") ||
						(body.source !== undefined &&
							body.source !== "manual" &&
							body.source !== "clone")
					) {
						return jsonError("Invalid coding repository request", 400);
					}
					return Response.json(
						await browserApi.registerCodingRepository({
							displayName: body.displayName,
							remoteUrl: body.remoteUrl,
							rootCwd: body.rootCwd,
							source: body.source,
						}),
					);
				}
				return jsonError("Method not allowed", 405);
			}

			const repositoryId = decodeURIComponent(encodedRepositoryId);
			if (action === "archive") {
				if (req.method !== "POST") {
					return jsonError("Method not allowed", 405);
				}
				if (!browserApi.archiveCodingRepository) {
					return jsonError("Coding repository API is not configured", 404);
				}
				return Response.json(
					await browserApi.archiveCodingRepository(repositoryId),
				);
			}

			if (action === "restore") {
				if (req.method !== "POST") {
					return jsonError("Method not allowed", 405);
				}
				if (!browserApi.restoreCodingRepository) {
					return jsonError("Coding repository API is not configured", 404);
				}
				return Response.json(
					await browserApi.restoreCodingRepository(repositoryId),
				);
			}

			if (action === "tree") {
				if (req.method !== "GET") {
					return jsonError("Method not allowed", 405);
				}
				if (!browserApi.listCodingRepositoryTree) {
					return jsonError("Coding repository API is not configured", 404);
				}
				return Response.json(
					await browserApi.listCodingRepositoryTree(repositoryId, {
						path: url.searchParams.get("path") ?? undefined,
					}),
				);
			}

			if (action === "workspace-files") {
				if (req.method !== "GET") {
					return jsonError("Method not allowed", 405);
				}
				if (!browserApi.listCodingRepositoryWorkspaceFiles) {
					return jsonError("Coding repository API is not configured", 404);
				}
				return Response.json(
					await browserApi.listCodingRepositoryWorkspaceFiles(repositoryId),
				);
			}

			if (action === "files") {
				const path = url.searchParams.get("path");
				if (!path) {
					return jsonError("Missing path query parameter", 400);
				}
				if (req.method === "PUT") {
					if (!browserApi.writeCodingRepositoryFile) {
						return jsonError("Coding repository API is not configured", 404);
					}
					const writeRequest = await readFileWriteRequest(req);
					if (!writeRequest.ok) {
						return jsonError(writeRequest.message, writeRequest.status);
					}
					return Response.json(
						await browserApi.writeCodingRepositoryFile(
							repositoryId,
							path,
							writeRequest.body.content,
							{
								mtimeMs: writeRequest.body.expectedMtimeMs,
								sha256: writeRequest.body.expectedSha256,
							},
						),
					);
				}
				if (req.method !== "GET") {
					return jsonError("Method not allowed", 405);
				}
				if (!browserApi.readCodingRepositoryFile) {
					return jsonError("Coding repository API is not configured", 404);
				}
				return Response.json(
					await browserApi.readCodingRepositoryFile(repositoryId, path),
				);
			}

			if (action === "skills") {
				if (req.method !== "GET") {
					return jsonError("Method not allowed", 405);
				}
				if (!browserApi.listCodingRepositorySkills) {
					return jsonError(
						"Coding repository skill API is not configured",
						404,
					);
				}
				return Response.json(
					await browserApi.listCodingRepositorySkills(repositoryId, {
						forceReload: url.searchParams.get("forceReload") === "true",
					}),
				);
			}

			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.getCodingRepository) {
				return jsonError("Coding repository API is not configured", 404);
			}
			return Response.json(await browserApi.getCodingRepository(repositoryId));
		}

		const codingSessionsMatch = url.pathname.match(
			/^\/api\/coding\/sessions(?:\/([^/]+)\/([^/]+)(?:\/(archive|restore|resume|events|stop))?)?$/,
		);
		if (codingSessionsMatch) {
			const [, encodedProviderId, encodedSdkSessionId, action] =
				codingSessionsMatch;

			if (encodedProviderId && encodedSdkSessionId) {
				const providerId = decodeURIComponent(encodedProviderId);
				const sdkSessionId = decodeURIComponent(encodedSdkSessionId);
				if (action === "archive") {
					if (req.method !== "POST") {
						return jsonError("Method not allowed", 405);
					}
					if (!browserApi.archiveCodingSession) {
						return jsonError("Coding session API is not configured", 404);
					}
					return Response.json(
						await browserApi.archiveCodingSession(providerId, sdkSessionId),
					);
				}
				if (action === "restore") {
					if (req.method !== "POST") {
						return jsonError("Method not allowed", 405);
					}
					if (!browserApi.restoreCodingSession) {
						return jsonError("Coding session API is not configured", 404);
					}
					return Response.json(
						await browserApi.restoreCodingSession(providerId, sdkSessionId),
					);
				}
				if (action === "events") {
					if (req.method !== "GET") {
						return jsonError("Method not allowed", 405);
					}
					if (!browserApi.openCodingSessionEventStream) {
						return jsonError("Coding session API is not configured", 404);
					}
					const sinceParam = url.searchParams.get("sinceSequence");
					let sinceSequence: number | undefined;
					if (sinceParam !== null) {
						const parsed = Number.parseInt(sinceParam, 10);
						if (!Number.isInteger(parsed) || parsed < 0) {
							return jsonError("Invalid sinceSequence", 400);
						}
						sinceSequence = parsed;
					}
					// EventSource auto-retry preserves the original URL — including a now
					// stale sinceSequence — but resends Last-Event-ID with the latest
					// frame the client received. Take the max so reconnects (manual or
					// browser-initiated) never replay events the client already saw.
					const lastEventId = req.headers.get("last-event-id");
					if (lastEventId) {
						const parsed = Number.parseInt(lastEventId, 10);
						if (Number.isInteger(parsed) && parsed >= 0) {
							sinceSequence = Math.max(sinceSequence ?? 0, parsed);
						}
					}
					const iterable = browserApi.openCodingSessionEventStream({
						providerId,
						sdkSessionId,
						...(sinceSequence !== undefined ? { sinceSequence } : {}),
						signal: req.signal,
					});
					return createSseResponse(iterable, req.signal);
				}
				if (action === "resume") {
					if (req.method !== "POST") {
						return jsonError("Method not allowed", 405);
					}
					if (!browserApi.resumeCodingSession) {
						return jsonError("Coding session API is not configured", 404);
					}
					let body: {
						prompt?: unknown;
						model?: unknown;
						effort?: unknown;
						serviceTier?: unknown;
					};
					try {
						body = (await req.json()) as typeof body;
					} catch {
						return jsonError("Invalid coding resume request", 400);
					}
					if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
						return jsonError("Invalid coding resume request", 400);
					}
					const modelOverride = readModelOverride(body.model);
					if (modelOverride.status === "invalid") {
						return jsonError(modelOverride.message, 400);
					}
					const effortOverride = readEffortOverride(body.effort);
					if (effortOverride.status === "invalid") {
						return jsonError(effortOverride.message, 400);
					}
					const serviceTierOverride = readServiceTierOverride(body.serviceTier);
					if (serviceTierOverride.status === "invalid") {
						return jsonError(serviceTierOverride.message, 400);
					}
					return Response.json(
						await browserApi.resumeCodingSession({
							providerId,
							sdkSessionId,
							prompt: body.prompt,
							...(modelOverride.value ? { model: modelOverride.value } : {}),
							...(effortOverride.value ? { effort: effortOverride.value } : {}),
							...(serviceTierOverride.value
								? { serviceTier: serviceTierOverride.value }
								: {}),
						}),
					);
				}
				if (action === "stop") {
					if (req.method !== "POST") {
						return jsonError("Method not allowed", 405);
					}
					if (!browserApi.stopCodingSession) {
						return jsonError("Coding session API is not configured", 404);
					}
					return Response.json(
						await browserApi.stopCodingSession({
							providerId,
							sdkSessionId,
						}),
					);
				}
				if (action) {
					return jsonError("Method not allowed", 405);
				}
				if (req.method === "GET") {
					if (!browserApi.getCodingSession) {
						return jsonError("Coding session API is not configured", 404);
					}
					return Response.json(
						await browserApi.getCodingSession(providerId, sdkSessionId),
					);
				}
				if (req.method === "DELETE") {
					if (!browserApi.deleteCodingSession) {
						return jsonError("Coding session API is not configured", 404);
					}
					return Response.json(
						await browserApi.deleteCodingSession(providerId, sdkSessionId),
					);
				}
				if (req.method === "PATCH") {
					if (!browserApi.renameCodingSession) {
						return jsonError("Coding session API is not configured", 404);
					}
					let body: { title?: unknown };
					try {
						body = (await req.json()) as typeof body;
					} catch {
						return jsonError("Invalid coding rename request", 400);
					}
					if (typeof body.title !== "string" || body.title.trim() === "") {
						return jsonError("Invalid coding rename request", 400);
					}
					return Response.json(
						await browserApi.renameCodingSession(
							providerId,
							sdkSessionId,
							body.title,
						),
					);
				}
				return jsonError("Method not allowed", 405);
			}

			if (req.method === "POST") {
				if (!browserApi.startCodingSession) {
					return jsonError("Coding session API is not configured", 404);
				}
				let body: {
					repositoryId?: unknown;
					cwd?: unknown;
					prompt?: unknown;
					linkedChatSessionId?: unknown;
					model?: unknown;
					effort?: unknown;
					serviceTier?: unknown;
				};
				try {
					body = (await req.json()) as typeof body;
				} catch {
					return jsonError("Invalid coding start request", 400);
				}
				if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
					return jsonError("Invalid coding start request", 400);
				}
				const modelOverride = readModelOverride(body.model);
				if (modelOverride.status === "invalid") {
					return jsonError(modelOverride.message, 400);
				}
				const effortOverride = readEffortOverride(body.effort);
				if (effortOverride.status === "invalid") {
					return jsonError(effortOverride.message, 400);
				}
				const serviceTierOverride = readServiceTierOverride(body.serviceTier);
				if (serviceTierOverride.status === "invalid") {
					return jsonError(serviceTierOverride.message, 400);
				}
				const startParams: {
					prompt: string;
					repositoryId?: string;
					cwd?: string;
					linkedChatSessionId?: string;
					model?: string;
					effort?: EffortLevel;
					serviceTier?: string;
				} = { prompt: body.prompt };
				if (typeof body.repositoryId === "string") {
					startParams.repositoryId = body.repositoryId;
				}
				if (typeof body.cwd === "string") {
					startParams.cwd = body.cwd;
				}
				if (typeof body.linkedChatSessionId === "string") {
					startParams.linkedChatSessionId = body.linkedChatSessionId;
				}
				if (modelOverride.value) {
					startParams.model = modelOverride.value;
				}
				if (effortOverride.value) {
					startParams.effort = effortOverride.value;
				}
				if (serviceTierOverride.value) {
					startParams.serviceTier = serviceTierOverride.value;
				}
				return Response.json(await browserApi.startCodingSession(startParams));
			}

			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.listCodingSessions) {
				return jsonError("Coding session API is not configured", 404);
			}
			const limitParam = url.searchParams.get("limit");
			const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;
			if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
				return jsonError("Invalid limit", 400);
			}
			const cursorLastActiveParam = url.searchParams.get("cursorLastActive");
			const cursorSessionId = url.searchParams.get("cursorSdkSessionId");
			let cursor: SessionCursor | undefined;
			if (cursorLastActiveParam !== null || cursorSessionId !== null) {
				const lastActive =
					cursorLastActiveParam === null
						? Number.NaN
						: Number.parseInt(cursorLastActiveParam, 10);
				if (
					!Number.isInteger(lastActive) ||
					lastActive < 0 ||
					!cursorSessionId
				) {
					return jsonError("Invalid session cursor", 400);
				}
				cursor = {
					lastActive,
					sdkSessionId: cursorSessionId,
				};
			}
			const linkedChatSessionId =
				url.searchParams.get("linkedChatSessionId") ?? undefined;
			const lifecycleStatusParam = url.searchParams.get("lifecycleStatus");
			if (
				lifecycleStatusParam !== null &&
				lifecycleStatusParam !== "open" &&
				lifecycleStatusParam !== "archived"
			) {
				return jsonError("Invalid coding session lifecycle status", 400);
			}
			const queryParam = url.searchParams.get("query");
			const searchQuery = queryParam
				? validateSessionSearchQuery(queryParam)
				: undefined;
			if (searchQuery && !searchQuery.ok) {
				return jsonError(searchQuery.message, 400);
			}
			const normalizedQuery = searchQuery?.ok
				? searchQuery.query || undefined
				: undefined;
			return Response.json(
				await browserApi.listCodingSessions({
					cursor,
					limit,
					linkedChatSessionId,
					...(lifecycleStatusParam
						? { lifecycleStatus: lifecycleStatusParam }
						: {}),
					providerId: url.searchParams.get("providerId") ?? undefined,
					...(normalizedQuery ? { query: normalizedQuery } : {}),
					repositoryId: url.searchParams.get("repositoryId") ?? undefined,
				}),
			);
		}

		const sessionsMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/sessions$/,
		);
		if (sessionsMatch) {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.listAgentSessions) {
				return jsonError("Session API is not configured", 404);
			}
			const agentId = decodeURIComponent(sessionsMatch[1] ?? "");
			const limitParam = url.searchParams.get("limit");
			const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;
			if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
				return jsonError("Invalid limit", 400);
			}
			const cursorLastActiveParam = url.searchParams.get("cursorLastActive");
			const cursorSessionId = url.searchParams.get("cursorSdkSessionId");
			let cursor: SessionCursor | undefined;
			if (cursorLastActiveParam !== null || cursorSessionId !== null) {
				const lastActive =
					cursorLastActiveParam === null
						? Number.NaN
						: Number.parseInt(cursorLastActiveParam, 10);
				if (
					!Number.isInteger(lastActive) ||
					lastActive < 0 ||
					!cursorSessionId
				) {
					return jsonError("Invalid session cursor", 400);
				}
				cursor = {
					lastActive,
					sdkSessionId: cursorSessionId,
				};
			}
			const queryParam = url.searchParams.get("query");
			const searchQuery = queryParam
				? validateSessionSearchQuery(queryParam)
				: undefined;
			if (searchQuery && !searchQuery.ok) {
				return jsonError(searchQuery.message, 400);
			}
			return Response.json(
				await browserApi.listAgentSessions(agentId, {
					cursor,
					limit,
					query: searchQuery?.ok ? searchQuery.query || undefined : undefined,
				}),
			);
		}

		const agentMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/(tree|graph|workspace-files|file|files|cron|terminal-run-command)$/,
		);
		if (!agentMatch) {
			return jsonError("Not found", 404);
		}

		const [, encodedAgentId, resource] = agentMatch;
		const agentId = decodeURIComponent(encodedAgentId ?? "");
		if (resource === "terminal-run-command") {
			if (req.method === "PATCH") {
				if (!browserApi.writeAgentTerminalRunCommand) {
					return jsonError("Terminal run command API is not configured", 404);
				}
				const body = (await req.json().catch(() => undefined)) as
					| { command?: unknown }
					| undefined;
				if (typeof body?.command !== "string") {
					return jsonError("Missing terminal run command", 400);
				}
				return Response.json(
					await browserApi.writeAgentTerminalRunCommand(agentId, body.command),
				);
			}

			return jsonError("Method not allowed", 405);
		}

		if (resource === "cron" && req.method === "PATCH") {
			const body = (await req.json().catch(() => undefined)) as
				| { enabled?: boolean; path?: string }
				| undefined;
			if (!body?.path || typeof body.enabled !== "boolean") {
				return jsonError("Missing cron path or enabled state", 400);
			}
			return Response.json(
				await browserApi.setAgentCronEnabled(agentId, body.path, body.enabled),
			);
		}

		if (resource === "tree") {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			return Response.json(await browserApi.listAgentTree(agentId));
		}
		if (resource === "graph") {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.listAgentGraph) {
				return jsonError("Graph API is not configured", 404);
			}
			return Response.json(await browserApi.listAgentGraph(agentId));
		}
		if (resource === "workspace-files") {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.listAgentWorkspaceFiles) {
				return jsonError("Workspace files API is not configured", 404);
			}
			return Response.json(await browserApi.listAgentWorkspaceFiles(agentId));
		}
		if (resource === "cron") {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			return Response.json(await browserApi.listAgentCron(agentId));
		}

		const path = url.searchParams.get("path");
		if (!path) {
			return jsonError("Missing path query parameter", 400);
		}
		if (resource === "file" && req.method === "PUT") {
			if (!browserApi.writeAgentFile) {
				return jsonError("File write API is not configured", 404);
			}
			const writeRequest = await readFileWriteRequest(req);
			if (!writeRequest.ok) {
				return jsonError(writeRequest.message, writeRequest.status);
			}
			return Response.json(
				await browserApi.writeAgentFile(
					agentId,
					path,
					writeRequest.body.content,
					{
						mtimeMs: writeRequest.body.expectedMtimeMs,
						sha256: writeRequest.body.expectedSha256,
					},
				),
			);
		}
		if (req.method !== "GET") {
			return jsonError("Method not allowed", 405);
		}
		return Response.json(await browserApi.readAgentFile(agentId, path));
	} catch (error) {
		if (error instanceof FileConflictError) {
			return Response.json(
				{ kind: "conflict", current: error.current },
				{ status: 409 },
			);
		}
		const message = error instanceof Error ? error.message : "Unexpected error";
		return jsonError(message, statusForBrowserApiError(message));
	}
}

function jsonError(message: string, status: number) {
	return Response.json(
		{
			error: message,
		},
		{ status },
	);
}

function readRepositoryIdParams(
	url: URL,
): { repositoryId?: string } | undefined {
	const repositoryId = url.searchParams.get("repositoryId");
	if (!repositoryId) {
		return undefined;
	}
	return { repositoryId };
}

function readGitHistoryParams(url: URL):
	| {
			status: "valid";
			value: { repositoryId?: string; cursor?: string; limit?: number };
	  }
	| { status: "invalid"; message: string } {
	const repositoryParams = readRepositoryIdParams(url) ?? {};
	const cursor = url.searchParams.get("cursor");
	if (cursor !== null && cursor !== "" && !/^\d+$/.test(cursor)) {
		return { status: "invalid", message: "Invalid git history cursor" };
	}

	const limitParam = url.searchParams.get("limit");
	let limit: number | undefined;
	if (limitParam !== null) {
		if (!/^\d+$/.test(limitParam)) {
			return { status: "invalid", message: "Invalid git history limit" };
		}
		limit = Number.parseInt(limitParam, 10);
		if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
			return { status: "invalid", message: "Invalid git history limit" };
		}
	}

	return {
		status: "valid",
		value: {
			...repositoryParams,
			...(cursor ? { cursor } : {}),
			...(limit !== undefined ? { limit } : {}),
		},
	};
}

async function readUploadedImages(req: Request) {
	const formData = await req.formData();
	const files = formData.getAll("images");
	const images: Array<{ bytes: Uint8Array; mediaType: ImageMediaType }> = [];

	for (const entry of files) {
		if (!(entry instanceof File)) {
			continue;
		}

		if (!isImageMediaType(entry.type)) {
			throw new Error(
				`Unsupported image media type: ${entry.type || "(empty)"}`,
			);
		}

		images.push({
			bytes: new Uint8Array(await entry.arrayBuffer()),
			mediaType: entry.type,
		});
	}

	if (images.length === 0) {
		throw new Error("Missing uploaded images");
	}

	return images;
}

async function readFileWriteRequest(req: Request): Promise<
	| {
			ok: true;
			body: {
				content: string;
				expectedMtimeMs: number;
				expectedSha256: string;
			};
	  }
	| { ok: false; message: string; status: number }
> {
	const maxBodyBytes = 1024 * 1024;
	const contentLength = req.headers.get("content-length");
	if (contentLength) {
		const declaredBytes = Number.parseInt(contentLength, 10);
		if (
			!Number.isFinite(declaredBytes) ||
			declaredBytes < 0 ||
			declaredBytes > maxBodyBytes
		) {
			return { ok: false, message: "File write body too large", status: 413 };
		}
	}

	const bytes = new Uint8Array(await req.arrayBuffer());
	if (bytes.byteLength > maxBodyBytes) {
		return { ok: false, message: "File write body too large", status: 413 };
	}

	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return { ok: false, message: "Malformed file write body", status: 400 };
	}

	if (!isFileWriteBody(body)) {
		return { ok: false, message: "Malformed file write body", status: 400 };
	}

	return { ok: true, body };
}

function isFileWriteBody(value: unknown): value is {
	content: string;
	expectedMtimeMs: number;
	expectedSha256: string;
} {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		typeof value.content === "string" &&
		"expectedMtimeMs" in value &&
		typeof value.expectedMtimeMs === "number" &&
		Number.isFinite(value.expectedMtimeMs) &&
		"expectedSha256" in value &&
		typeof value.expectedSha256 === "string"
	);
}

function isImageMediaType(type: string): type is ImageMediaType {
	return (
		type === "image/jpeg" ||
		type === "image/png" ||
		type === "image/gif" ||
		type === "image/webp"
	);
}

function createSseResponse<
	T extends { sequence: number; providerId: string; sdkSessionId: string },
>(iterable: AsyncIterable<T>, signal: AbortSignal): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const abort = () => {
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			if (signal.aborted) {
				abort();
				return;
			}
			signal.addEventListener("abort", abort, { once: true });
			try {
				for await (const item of iterable) {
					if (signal.aborted) {
						return;
					}
					const payload = `id: ${item.sequence}\ndata: ${JSON.stringify(
						item,
					)}\n\n`;
					controller.enqueue(encoder.encode(payload));
				}
			} catch (err) {
				if (!signal.aborted) {
					const message = err instanceof Error ? err.message : String(err);
					const payload = `event: error\ndata: ${JSON.stringify({
						message,
					})}\n\n`;
					try {
						controller.enqueue(encoder.encode(payload));
					} catch {
						// stream already closed
					}
				}
			} finally {
				signal.removeEventListener("abort", abort);
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		},
	});
}

type OverrideReadResult<T> =
	| { status: "absent"; value: undefined }
	| { status: "valid"; value: T }
	| { status: "invalid"; message: string };

function readModelOverride(raw: unknown): OverrideReadResult<string> {
	if (raw === undefined || raw === null) {
		return { status: "absent", value: undefined };
	}
	if (typeof raw !== "string" || raw.trim() === "") {
		return {
			status: "invalid",
			message: "Coding model override must be a non-empty string",
		};
	}
	return { status: "valid", value: raw };
}

function readEffortOverride(raw: unknown): OverrideReadResult<EffortLevel> {
	if (raw === undefined || raw === null) {
		return { status: "absent", value: undefined };
	}
	if (typeof raw !== "string" || !isEffortLevel(raw)) {
		return {
			status: "invalid",
			message:
				"Coding effort override must be one of low/medium/high/xhigh/max",
		};
	}
	return { status: "valid", value: raw };
}

function readServiceTierOverride(raw: unknown): OverrideReadResult<string> {
	if (raw === undefined || raw === null) {
		return { status: "absent", value: undefined };
	}
	if (typeof raw !== "string" || raw.trim() === "") {
		return {
			status: "invalid",
			message: "Coding service tier override must be a non-empty string",
		};
	}
	return { status: "valid", value: raw };
}

function statusForBrowserApiError(message: string): number {
	if (
		message.startsWith("Unknown agent:") ||
		message.startsWith("Unknown coding repository:") ||
		message.startsWith("Unknown coding session:") ||
		message.startsWith("Unknown commit:")
	) {
		return 404;
	}
	if (
		message === "Path is required" ||
		message === "Terminal run command must be a single line" ||
		message.startsWith("Path escapes") ||
		message === "Path escapes cron directory" ||
		message === "Path must reference a file directly in inbox" ||
		message === "Path does not reference a file"
	) {
		return 400;
	}
	return 500;
}
