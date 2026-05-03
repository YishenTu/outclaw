import type {
	BrowserAgentsResponse,
	BrowserConfigResponse,
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronHistoryResponse,
	BrowserFileResponse,
	BrowserGitCommitResponse,
	BrowserGitDiffResponse,
	BrowserGitStatusResponse,
	BrowserInboxArchiveResponse,
	BrowserInboxCreateNoteInput,
	BrowserInboxCreateNoteResponse,
	BrowserInboxResponse,
	BrowserInboxRestoreResponse,
	BrowserTerminalRunCommandResponse,
	BrowserTreeEntry,
	ImageMediaType,
	WorkspaceFileEntry,
} from "../../common/protocol.ts";

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
	listAgentTree(agentId: string): Promise<BrowserTreeEntry[]>;
	listAgentWorkspaceFiles?(agentId: string): Promise<WorkspaceFileEntry[]>;
	listAgents(): BrowserAgentsResponse;
	readAgentFile(
		agentId: string,
		relativePath: string,
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
): Promise<Response> {
	if (!browserApi) {
		return jsonError("Browser API is not configured", 404);
	}

	try {
		if (url.pathname === "/api/agents") {
			return Response.json(browserApi.listAgents());
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

		const agentMatch = url.pathname.match(
			/^\/api\/agents\/([^/]+)\/(tree|workspace-files|files|cron|terminal-run-command)$/,
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

		if (req.method !== "GET") {
			return jsonError("Method not allowed", 405);
		}

		if (resource === "tree") {
			return Response.json(await browserApi.listAgentTree(agentId));
		}
		if (resource === "workspace-files") {
			if (!browserApi.listAgentWorkspaceFiles) {
				return jsonError("Workspace files API is not configured", 404);
			}
			return Response.json(await browserApi.listAgentWorkspaceFiles(agentId));
		}
		if (resource === "cron") {
			return Response.json(await browserApi.listAgentCron(agentId));
		}

		const path = url.searchParams.get("path");
		if (!path) {
			return jsonError("Missing path query parameter", 400);
		}
		return Response.json(await browserApi.readAgentFile(agentId, path));
	} catch (error) {
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
