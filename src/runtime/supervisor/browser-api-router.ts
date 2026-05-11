import type {
	BrowserAgentsResponse,
	BrowserCodingRepositoryArchiveResponse,
	BrowserCodingRepositoryDetail,
	BrowserCodingRepositoryListResponse,
	BrowserCodingRepositorySource,
	BrowserCodingSessionDeleteResponse,
	BrowserCodingSessionDetail,
	BrowserCodingSessionPageResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserGraphResponse,
	BrowserInboxArchiveResponse,
	BrowserInboxCreateNoteInput,
	BrowserInboxCreateNoteResponse,
	BrowserInboxResponse,
	BrowserInboxRestoreResponse,
	BrowserLatencyResponse,
	BrowserSessionPageResponse,
	BrowserTerminalRunCommandResponse,
	BrowserTreeEntry,
	ImageMediaType,
	SessionCursor,
	WorkspaceFileEntry,
} from "../../common/protocol.ts";
import { validateSessionSearchQuery } from "../application/session-search-query.ts";
import { FileConflictError } from "../browser/files/write-browser-file.ts";

export interface BrowserApi {
	getAgentTerminalCwd(agentId: string): string | undefined;
	archiveAgentInboxItem?(
		agentId: string,
		relativePath: string,
	): Promise<BrowserInboxArchiveResponse>;
	createAgentInboxNote?(
		agentId: string,
		input: BrowserInboxCreateNoteInput,
	): Promise<BrowserInboxCreateNoteResponse>;
	initGitRepo(): Promise<BrowserGitStatusResponse>;
	listAgentCron(agentId: string): Promise<BrowserCronEntry[]>;
	listAgentCronHistory?(
		agentId: string,
		params: {
			jobName: string;
			limit: number;
			before?: BrowserCronHistoryCursor;
		},
	): Promise<BrowserCronHistoryResponse>;
	listAgentInbox?(agentId: string): Promise<BrowserInboxResponse>;
	listAgentSessions?(
		agentId: string,
		params: {
			limit: number;
			cursor?: SessionCursor;
			query?: string;
		},
	): Promise<BrowserSessionPageResponse>;
	listCodingSessions?(params: {
		limit: number;
		cursor?: SessionCursor;
		linkedChatSessionId?: string;
		providerId?: string;
		repositoryId?: string;
	}): Promise<BrowserCodingSessionPageResponse>;
	listCodingRepositories?(params?: {
		includeArchived?: boolean;
	}): Promise<BrowserCodingRepositoryListResponse>;
	getCodingRepository?(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryDetail>;
	registerCodingRepository?(params: {
		displayName?: string;
		remoteUrl?: string;
		rootCwd: string;
		source?: Extract<BrowserCodingRepositorySource, "manual" | "clone">;
	}): Promise<BrowserCodingRepositoryDetail>;
	archiveCodingRepository?(
		repositoryId: string,
	): Promise<BrowserCodingRepositoryArchiveResponse>;
	getCodingSession?(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDetail>;
	deleteCodingSession?(
		providerId: string,
		sdkSessionId: string,
	): Promise<BrowserCodingSessionDeleteResponse>;
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
	listAgentGraph?(agentId: string): Promise<BrowserGraphResponse>;
	listAgentWorkspaceFiles?(agentId: string): Promise<WorkspaceFileEntry[]>;
	listAgents(params?: { browserClientId?: string }): BrowserAgentsResponse;
	readAgentFile(
		agentId: string,
		relativePath: string,
	): Promise<BrowserFileResponse>;
	writeAgentFile?(
		agentId: string,
		relativePath: string,
		content: string,
		expected: { mtimeMs: number; sha256: string },
	): Promise<BrowserFileResponse>;
	readConfigFile(): Promise<BrowserConfigResponse>;
	readGitCommit(sha: string): Promise<BrowserGitCommitResponse>;
	readGitDiff(path: string): Promise<BrowserGitDiffResponse>;
	readGitStatus(): Promise<BrowserGitStatusResponse>;
	restoreAgentInboxItem?(
		agentId: string,
		archivedPath: string,
		originalPath: string,
	): Promise<BrowserInboxRestoreResponse>;
	setAgentCronEnabled(
		agentId: string,
		relativePath: string,
		enabled: boolean,
	): Promise<BrowserCronEntry>;
	uploadImages?(
		images: Array<{ bytes: Uint8Array; mediaType: ImageMediaType }>,
	): Promise<Array<{ path: string; mediaType: ImageMediaType }>>;
	writeAgentTerminalRunCommand?(
		agentId: string,
		command: string,
	): Promise<BrowserTerminalRunCommandResponse>;
	writeConfigFile(
		document: Record<string, unknown>,
	): Promise<BrowserConfigResponse>;
}

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
			return Response.json(await browserApi.readGitStatus());
		}

		if (url.pathname === "/api/git/init") {
			if (req.method !== "POST") {
				return jsonError("Method not allowed", 405);
			}
			return Response.json(await browserApi.initGitRepo());
		}

		if (url.pathname === "/api/git/diff") {
			const path = url.searchParams.get("path");
			if (!path) {
				return jsonError("Missing path query parameter", 400);
			}
			return Response.json(await browserApi.readGitDiff(path));
		}

		if (url.pathname === "/api/git/commit") {
			const sha = url.searchParams.get("sha");
			if (!sha) {
				return jsonError("Missing sha query parameter", 400);
			}
			return Response.json(await browserApi.readGitCommit(sha));
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

		const codingRepositoriesMatch = url.pathname.match(
			/^\/api\/coding\/repositories(?:\/([^/]+)(?:\/(archive))?)?$/,
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

			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.getCodingRepository) {
				return jsonError("Coding repository API is not configured", 404);
			}
			return Response.json(await browserApi.getCodingRepository(repositoryId));
		}

		const codingSessionsMatch = url.pathname.match(
			/^\/api\/coding\/sessions(?:\/([^/]+)\/([^/]+))?$/,
		);
		if (codingSessionsMatch) {
			const [, encodedProviderId, encodedSdkSessionId] = codingSessionsMatch;

			if (encodedProviderId && encodedSdkSessionId) {
				const providerId = decodeURIComponent(encodedProviderId);
				const sdkSessionId = decodeURIComponent(encodedSdkSessionId);
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
				return jsonError("Method not allowed", 405);
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
			return Response.json(
				await browserApi.listCodingSessions({
					cursor,
					limit,
					linkedChatSessionId,
					providerId: url.searchParams.get("providerId") ?? undefined,
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
