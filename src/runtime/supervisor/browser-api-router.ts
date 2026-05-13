import type {
	BrowserChatCodingLinksChangedEvent,
	BrowserCronHistoryCursor,
	BrowserLatencyResponse,
	ImageMediaType,
	SessionCursor,
} from "../../common/protocol.ts";
import { validateSessionSearchQuery } from "../application/session-search-query.ts";
import type { BrowserApi as BrowserApiImpl } from "../browser/create-browser-api.ts";
import { FileConflictError } from "../browser/files/write-browser-file.ts";
import { jsonError, readFileWriteRequest } from "./browser-http.ts";
import { handleCodingBrowserApiRequest } from "./coding-browser-api-router.ts";

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

export interface BrowserApiRequestContext {
	browserClientId?: string;
	onChatCodingLinksChanged?: (
		event: BrowserChatCodingLinksChangedEvent,
	) => void | Promise<void>;
}

export async function handleBrowserApiRequest(
	req: Request,
	url: URL,
	browserApi: BrowserApi | undefined,
	context: BrowserApiRequestContext = {},
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

		const codingResponse = await handleCodingBrowserApiRequest(
			req,
			url,
			browserApi,
			context,
		);
		if (codingResponse) {
			return codingResponse;
		}

		const activeSessionMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/active-session$/,
		);
		if (activeSessionMatch) {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.getAgentActiveSession) {
				return jsonError("Agent active session API is not configured", 404);
			}
			const agentId = decodeURIComponent(activeSessionMatch[1] ?? "");
			return Response.json(browserApi.getAgentActiveSession(agentId));
		}

		const codingLinksMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/sessions\/([^/]+)\/([^/]+)\/coding-links$/,
		);
		if (codingLinksMatch) {
			if (req.method !== "GET") {
				return jsonError("Method not allowed", 405);
			}
			if (!browserApi.listChatCodingSessions) {
				return jsonError("Chat coding link API is not configured", 404);
			}
			const [, encodedAgentId, encodedProviderId, encodedSdkSessionId] =
				codingLinksMatch;
			return Response.json(
				await browserApi.listChatCodingSessions({
					agentId: decodeURIComponent(encodedAgentId ?? ""),
					providerId: decodeURIComponent(encodedProviderId ?? ""),
					sdkSessionId: decodeURIComponent(encodedSdkSessionId ?? ""),
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
