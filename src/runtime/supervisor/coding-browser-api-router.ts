import { type EffortLevel, isEffortLevel } from "../../common/commands.ts";
import type { SessionCursor } from "../../common/protocol.ts";
import { validateSessionSearchQuery } from "../application/session-search-query.ts";
import type {
	BrowserApi,
	BrowserApiRequestContext,
} from "./browser-api-router.ts";
import {
	createSseResponse,
	jsonError,
	readFileWriteRequest,
} from "./browser-http.ts";

interface ChatCodingContext {
	chatAgentId: string;
	chatProviderId: string;
	chatSdkSessionId: string;
}

export async function handleCodingBrowserApiRequest(
	req: Request,
	url: URL,
	browserApi: BrowserApi,
	context: BrowserApiRequestContext = {},
): Promise<Response | undefined> {
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
		/^\/api\/coding\/repositories(?:\/([^/]+)(?:\/(archive|trash|restore|tree|workspace-files|files|skills|terminal-run-command))?)?$/,
	);
	if (codingRepositoriesMatch) {
		return handleCodingRepositoryRequest(
			req,
			url,
			browserApi,
			codingRepositoriesMatch,
		);
	}

	const codingSessionsMatch = url.pathname.match(
		/^\/api\/coding\/sessions(?:\/([^/]+)\/([^/]+)(?:\/(archive|trash|restore|resume|events|stop|cancel|status))?)?$/,
	);
	if (codingSessionsMatch) {
		return handleCodingSessionRequest(
			req,
			url,
			browserApi,
			context,
			codingSessionsMatch,
		);
	}

	return undefined;
}

async function handleCodingRepositoryRequest(
	req: Request,
	url: URL,
	browserApi: BrowserApi,
	match: RegExpMatchArray,
): Promise<Response> {
	const [, encodedRepositoryId, action] = match;
	if (!encodedRepositoryId) {
		if (req.method === "GET") {
			if (!browserApi.listCodingRepositories) {
				return jsonError("Coding repository API is not configured", 404);
			}
			return Response.json(
				await browserApi.listCodingRepositories({
					includeArchived: url.searchParams.get("includeArchived") === "true",
					includeTrashed: url.searchParams.get("includeTrashed") === "true",
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
				(body.remoteUrl !== undefined && typeof body.remoteUrl !== "string") ||
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

	if (action === "trash") {
		if (req.method !== "POST") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.trashCodingRepository) {
			return jsonError("Coding repository API is not configured", 404);
		}
		return Response.json(await browserApi.trashCodingRepository(repositoryId));
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

	if (action === "terminal-run-command") {
		if (req.method !== "PATCH") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.writeCodingRepositoryTerminalRunCommand) {
			return jsonError("Terminal run command API is not configured", 404);
		}
		const body = (await req.json().catch(() => undefined)) as
			| { command?: unknown }
			| undefined;
		if (typeof body?.command !== "string") {
			return jsonError("Missing terminal run command", 400);
		}
		return Response.json(
			await browserApi.writeCodingRepositoryTerminalRunCommand(
				repositoryId,
				body.command,
			),
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
				providerId: url.searchParams.get("providerId") ?? undefined,
				sdkSessionId: url.searchParams.get("sdkSessionId") ?? undefined,
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
			return jsonError("Coding repository skill API is not configured", 404);
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

async function handleCodingSessionRequest(
	req: Request,
	url: URL,
	browserApi: BrowserApi,
	context: BrowserApiRequestContext,
	match: RegExpMatchArray,
): Promise<Response> {
	const [, encodedProviderId, encodedSdkSessionId, action] = match;

	if (encodedProviderId && encodedSdkSessionId) {
		const providerId = decodeURIComponent(encodedProviderId);
		const sdkSessionId = decodeURIComponent(encodedSdkSessionId);
		return handleTargetedCodingSessionRequest(req, url, browserApi, context, {
			action,
			providerId,
			sdkSessionId,
		});
	}

	if (req.method === "POST") {
		return startCodingSession(req, browserApi, context);
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
	const cursor = readSessionCursor(url);
	if (cursor.status === "invalid") {
		return jsonError(cursor.message, 400);
	}
	const lifecycleStatusParam = url.searchParams.get("lifecycleStatus");
	if (
		lifecycleStatusParam !== null &&
		lifecycleStatusParam !== "open" &&
		lifecycleStatusParam !== "archived" &&
		lifecycleStatusParam !== "trashed"
	) {
		return jsonError("Invalid coding session lifecycle status", 400);
	}
	const searchQuery = readValidatedSearchQuery(url);
	if (searchQuery.status === "invalid") {
		return jsonError(searchQuery.message, 400);
	}
	return Response.json(
		await browserApi.listCodingSessions({
			cursor: cursor.value,
			limit,
			linkedChatSessionId:
				url.searchParams.get("linkedChatSessionId") ?? undefined,
			...(lifecycleStatusParam
				? { lifecycleStatus: lifecycleStatusParam }
				: {}),
			providerId: url.searchParams.get("providerId") ?? undefined,
			...(searchQuery.value ? { query: searchQuery.value } : {}),
			repositoryId: url.searchParams.get("repositoryId") ?? undefined,
		}),
	);
}

async function handleTargetedCodingSessionRequest(
	req: Request,
	url: URL,
	browserApi: BrowserApi,
	context: BrowserApiRequestContext,
	target: { action?: string; providerId: string; sdkSessionId: string },
): Promise<Response> {
	if (target.action === "archive") {
		if (req.method !== "POST") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.archiveCodingSession) {
			return jsonError("Coding session API is not configured", 404);
		}
		return Response.json(
			await browserApi.archiveCodingSession(
				target.providerId,
				target.sdkSessionId,
			),
		);
	}
	if (target.action === "trash") {
		if (req.method !== "POST") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.trashCodingSession) {
			return jsonError("Coding session API is not configured", 404);
		}
		return Response.json(
			await browserApi.trashCodingSession(
				target.providerId,
				target.sdkSessionId,
			),
		);
	}
	if (target.action === "restore") {
		if (req.method !== "POST") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.restoreCodingSession) {
			return jsonError("Coding session API is not configured", 404);
		}
		return Response.json(
			await browserApi.restoreCodingSession(
				target.providerId,
				target.sdkSessionId,
			),
		);
	}
	if (target.action === "events") {
		return streamCodingSessionEvents(req, url, browserApi, target);
	}
	if (target.action === "status") {
		if (req.method !== "GET") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.getCodingSessionStatus) {
			return jsonError("Coding session API is not configured", 404);
		}
		const chatContext = readChatCodingContext(req);
		if (chatContext.status === "invalid") {
			return jsonError(chatContext.message, 400);
		}
		const result = await browserApi.getCodingSessionStatus(
			target.providerId,
			target.sdkSessionId,
		);
		await linkChatCodingSession(
			browserApi,
			chatContext.value,
			{
				providerId: target.providerId,
				sdkSessionId: target.sdkSessionId,
			},
			context,
		);
		return Response.json(result);
	}
	if (target.action === "resume") {
		return resumeCodingSession(req, browserApi, context, target);
	}
	if (target.action === "stop") {
		if (req.method !== "POST") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.stopCodingSession) {
			return jsonError("Coding session API is not configured", 404);
		}
		return Response.json(
			await browserApi.stopCodingSession({
				providerId: target.providerId,
				sdkSessionId: target.sdkSessionId,
			}),
		);
	}
	if (target.action === "cancel") {
		if (req.method !== "POST") {
			return jsonError("Method not allowed", 405);
		}
		if (!browserApi.cancelCodingSession) {
			return jsonError("Coding session API is not configured", 404);
		}
		return Response.json(
			await browserApi.cancelCodingSession({
				providerId: target.providerId,
				sdkSessionId: target.sdkSessionId,
			}),
		);
	}
	if (target.action) {
		return jsonError("Method not allowed", 405);
	}
	if (req.method === "GET") {
		if (!browserApi.getCodingSession) {
			return jsonError("Coding session API is not configured", 404);
		}
		return Response.json(
			await browserApi.getCodingSession(target.providerId, target.sdkSessionId),
		);
	}
	if (req.method === "DELETE") {
		if (!browserApi.deleteCodingSession) {
			return jsonError("Coding session API is not configured", 404);
		}
		return Response.json(
			await browserApi.deleteCodingSession(
				target.providerId,
				target.sdkSessionId,
			),
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
				target.providerId,
				target.sdkSessionId,
				body.title,
			),
		);
	}
	return jsonError("Method not allowed", 405);
}

function streamCodingSessionEvents(
	req: Request,
	url: URL,
	browserApi: BrowserApi,
	target: { providerId: string; sdkSessionId: string },
): Response {
	if (req.method !== "GET") {
		return jsonError("Method not allowed", 405);
	}
	if (!browserApi.openCodingSessionEventStream) {
		return jsonError("Coding session API is not configured", 404);
	}
	const sinceSequence = readSinceSequence(req, url);
	if (sinceSequence.status === "invalid") {
		return jsonError(sinceSequence.message, 400);
	}
	const iterable = browserApi.openCodingSessionEventStream({
		providerId: target.providerId,
		sdkSessionId: target.sdkSessionId,
		...(url.searchParams.get("follow") === "false" ? { follow: false } : {}),
		...(sinceSequence.value !== undefined
			? { sinceSequence: sinceSequence.value }
			: {}),
		signal: req.signal,
	});
	return createSseResponse(iterable, req.signal);
}

async function resumeCodingSession(
	req: Request,
	browserApi: BrowserApi,
	context: BrowserApiRequestContext,
	target: { providerId: string; sdkSessionId: string },
): Promise<Response> {
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
	const overrides = readCodingOverrides(body);
	if (overrides.status === "invalid") {
		return jsonError(overrides.message, 400);
	}
	const chatContext = readChatCodingContext(req);
	if (chatContext.status === "invalid") {
		return jsonError(chatContext.message, 400);
	}
	const result = await browserApi.resumeCodingSession({
		providerId: target.providerId,
		sdkSessionId: target.sdkSessionId,
		prompt: body.prompt,
		...overrides.value,
	});
	if (result.status === "accepted") {
		await linkChatCodingSession(
			browserApi,
			chatContext.value,
			{
				providerId: result.providerId,
				sdkSessionId: result.sdkSessionId,
			},
			context,
		);
	}
	return Response.json(result);
}

async function startCodingSession(
	req: Request,
	browserApi: BrowserApi,
	context: BrowserApiRequestContext,
): Promise<Response> {
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
	const overrides = readCodingOverrides(body);
	if (overrides.status === "invalid") {
		return jsonError(overrides.message, 400);
	}
	const chatContext = readChatCodingContext(req);
	if (chatContext.status === "invalid") {
		return jsonError(chatContext.message, 400);
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
	const result = await browserApi.startCodingSession({
		...startParams,
		...overrides.value,
	});
	if (result.status === "accepted") {
		await linkChatCodingSession(
			browserApi,
			chatContext.value,
			{
				providerId: result.providerId,
				sdkSessionId: result.sdkSessionId,
			},
			context,
		);
	}
	return Response.json(result);
}

function readChatCodingContext(
	req: Request,
):
	| { status: "valid"; value: ChatCodingContext }
	| { status: "absent"; value: undefined }
	| { status: "invalid"; message: string } {
	const chatAgentId = req.headers.get("x-outclaw-chat-agent-id")?.trim();
	const chatProviderId = req.headers.get("x-outclaw-chat-provider-id")?.trim();
	const chatSdkSessionId = req.headers.get("x-outclaw-chat-session-id")?.trim();
	if (!chatAgentId && !chatProviderId && !chatSdkSessionId) {
		return { status: "absent", value: undefined };
	}
	if (!chatAgentId || !chatProviderId || !chatSdkSessionId) {
		return {
			status: "invalid",
			message: "Invalid chat coding context headers",
		};
	}
	return {
		status: "valid",
		value: {
			chatAgentId,
			chatProviderId,
			chatSdkSessionId,
		},
	};
}

async function linkChatCodingSession(
	browserApi: BrowserApi,
	chatContext: ChatCodingContext | undefined,
	codingSession: { providerId: string; sdkSessionId: string },
	context: BrowserApiRequestContext,
) {
	if (!chatContext || !browserApi.linkChatCodingSession) {
		return;
	}
	await browserApi.linkChatCodingSession({
		...chatContext,
		codingProviderId: codingSession.providerId,
		codingSdkSessionId: codingSession.sdkSessionId,
	});
	await context.onChatCodingLinksChanged?.({
		type: "browser_chat_coding_links_changed",
		...chatContext,
		codingProviderId: codingSession.providerId,
		codingSdkSessionId: codingSession.sdkSessionId,
	});
}

function readSinceSequence(
	req: Request,
	url: URL,
):
	| { status: "valid"; value?: number }
	| { status: "invalid"; message: string } {
	const sinceParam = url.searchParams.get("sinceSequence");
	let sinceSequence: number | undefined;
	if (sinceParam !== null) {
		const parsed = Number.parseInt(sinceParam, 10);
		if (!Number.isInteger(parsed) || parsed < 0) {
			return { status: "invalid", message: "Invalid sinceSequence" };
		}
		sinceSequence = parsed;
	}
	const lastEventId = req.headers.get("last-event-id");
	if (lastEventId) {
		const parsed = Number.parseInt(lastEventId, 10);
		if (Number.isInteger(parsed) && parsed >= 0) {
			sinceSequence = Math.max(sinceSequence ?? 0, parsed);
		}
	}
	return { status: "valid", value: sinceSequence };
}

function readSessionCursor(
	url: URL,
):
	| { status: "valid"; value?: SessionCursor }
	| { status: "invalid"; message: string } {
	const cursorLastActiveParam = url.searchParams.get("cursorLastActive");
	const cursorSessionId = url.searchParams.get("cursorSdkSessionId");
	if (cursorLastActiveParam === null && cursorSessionId === null) {
		return { status: "valid", value: undefined };
	}
	const lastActive =
		cursorLastActiveParam === null
			? Number.NaN
			: Number.parseInt(cursorLastActiveParam, 10);
	if (!Number.isInteger(lastActive) || lastActive < 0 || !cursorSessionId) {
		return { status: "invalid", message: "Invalid session cursor" };
	}
	return {
		status: "valid",
		value: {
			lastActive,
			sdkSessionId: cursorSessionId,
		},
	};
}

function readValidatedSearchQuery(
	url: URL,
):
	| { status: "valid"; value?: string }
	| { status: "invalid"; message: string } {
	const queryParam = url.searchParams.get("query");
	const searchQuery = queryParam
		? validateSessionSearchQuery(queryParam)
		: undefined;
	if (searchQuery && !searchQuery.ok) {
		return { status: "invalid", message: searchQuery.message };
	}
	return {
		status: "valid",
		value: searchQuery?.ok ? searchQuery.query || undefined : undefined,
	};
}

type OverrideReadResult<T> =
	| { status: "absent"; value: undefined }
	| { status: "valid"; value: T }
	| { status: "invalid"; message: string };

function readCodingOverrides(body: {
	model?: unknown;
	effort?: unknown;
	serviceTier?: unknown;
}):
	| {
			status: "valid";
			value: { model?: string; effort?: EffortLevel; serviceTier?: string };
	  }
	| { status: "invalid"; message: string } {
	const modelOverride = readModelOverride(body.model);
	if (modelOverride.status === "invalid") {
		return modelOverride;
	}
	const effortOverride = readEffortOverride(body.effort);
	if (effortOverride.status === "invalid") {
		return effortOverride;
	}
	const serviceTierOverride = readServiceTierOverride(body.serviceTier);
	if (serviceTierOverride.status === "invalid") {
		return serviceTierOverride;
	}
	return {
		status: "valid",
		value: {
			...(modelOverride.value ? { model: modelOverride.value } : {}),
			...(effortOverride.value ? { effort: effortOverride.value } : {}),
			...(serviceTierOverride.value
				? { serviceTier: serviceTierOverride.value }
				: {}),
		},
	};
}

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
