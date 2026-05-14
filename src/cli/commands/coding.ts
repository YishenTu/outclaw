import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
	BrowserAgentActiveSessionResponse,
	BrowserCodingRepositoryListResponse,
	BrowserCodingRepositorySummary,
	BrowserCodingSessionCancelResponse,
	BrowserCodingSessionPageResponse,
	BrowserCodingSessionResumeResponse,
	BrowserCodingSessionStartResponse,
	BrowserCodingSessionStatusResponse,
	CodingSessionEvent,
} from "../../common/protocol.ts";
import { loadGlobalConfig } from "../../runtime/config/index.ts";
import {
	formatCodingCancelUsage,
	formatCodingListUsage,
	formatCodingResumeUsage,
	formatCodingStartUsage,
	formatCodingStatusUsage,
	formatCodingTranscriptUsage,
	formatCodingUsage,
	isHelpFlag,
	printCodingUsage,
} from "../support/usage.ts";
import { resolveSenderAgent } from "./agent-message.ts";

interface CodingCommandOptions {
	argv: string[];
	homeDir: string;
}

type CodingStartBody =
	| {
			cwd: string;
			prompt: string;
	  }
	| {
			repositoryId: string;
			prompt: string;
	  };

interface CodingChatContext {
	chatAgentId: string;
	chatProviderId: string;
	chatSdkSessionId: string;
}

export async function codingCommand(options: CodingCommandOptions) {
	const subcommand = options.argv[3];
	if (subcommand === undefined || isHelpFlag(subcommand)) {
		printCodingUsage();
		process.exit(subcommand === undefined ? 1 : 0);
	}

	switch (subcommand) {
		case "start":
			await runCodingSubcommand(() => codingStartCommand(options));
			return;
		case "resume":
			await runCodingSubcommand(() => codingResumeCommand(options));
			return;
		case "list":
			await runCodingSubcommand(() => codingListCommand(options));
			return;
		case "cancel":
			await runCodingSubcommand(() => codingCancelCommand(options));
			return;
		case "monitor":
			console.error(
				"oc coding monitor was removed; use oc coding transcript for history or oc coding status for a snapshot.",
			);
			process.exit(1);
			return;
		case "status":
			await runCodingSubcommand(() => codingStatusCommand(options));
			return;
		case "transcript":
			await runCodingSubcommand(() => codingTranscriptCommand(options));
			return;
		default:
			await runCodingSubcommand(() => codingTargetCommand(options));
			return;
	}
}

async function runCodingSubcommand(command: () => Promise<void>) {
	try {
		await command();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

async function codingStartCommand(options: CodingCommandOptions) {
	const args = options.argv.slice(4);
	if (isHelpFlag(args[0])) {
		console.log(formatCodingStartUsage());
		process.exit(0);
	}

	const target = args[0];
	const prompt = args.slice(1).join(" ").trim();
	if (!target || !prompt) {
		console.error(formatCodingStartUsage());
		process.exit(1);
	}

	const chatContext = await resolveCodingChatContext(options);
	const result = await postCodingStart(
		options.homeDir,
		resolveStartBody(target, prompt),
		chatContext,
	);
	exitWithCodingResult(result);
}

async function codingResumeCommand(options: CodingCommandOptions) {
	const args = options.argv.slice(4);
	if (isHelpFlag(args[0])) {
		console.log(formatCodingResumeUsage());
		process.exit(0);
	}

	const sessionRef = args[0];
	const prompt = args.slice(1).join(" ").trim();
	if (!sessionRef || !prompt) {
		console.error(formatCodingResumeUsage());
		process.exit(1);
	}

	const ref = parseExplicitSessionRef(sessionRef);
	if (!ref) {
		console.error("Coding session ref must use provider/session format");
		process.exit(1);
	}

	const chatContext = await resolveCodingChatContext(options);
	const result = await postCodingResume(
		options.homeDir,
		ref,
		{ prompt },
		chatContext,
	);
	exitWithCodingResult(result);
}

async function codingListCommand(options: CodingCommandOptions) {
	const args = options.argv.slice(4);
	if (isHelpFlag(args[0])) {
		console.log(formatCodingListUsage());
		process.exit(0);
	}
	const listOptions = parseCodingListOptions(args);
	if (listOptions.status === "invalid") {
		console.error(listOptions.message);
		process.exit(1);
	}

	const repositoriesResponse = await getCodingRepositories(options.homeDir, {
		includeArchived: listOptions.value.all,
	});
	const repositoryFilter = resolveCodingRepositoryFilter(
		listOptions.value.repo,
		repositoriesResponse.repositories,
	);
	if (repositoryFilter?.unknown) {
		console.error(`Unknown repo: ${repositoryFilter.unknown}`);
		process.exit(1);
	}
	const repositories = filterCodingRepositories(
		repositoriesResponse.repositories,
		repositoryFilter,
	);
	const sessions =
		repositoryFilter?.rootCwd && !repositoryFilter.repositoryId
			? []
			: await getCodingListSessions(options.homeDir, {
					all: listOptions.value.all,
					repositoryId: repositoryFilter?.repositoryId,
				});
	const statuses = await Promise.all(
		sessions.map((session) =>
			getCodingStatus(options.homeDir, {
				providerId: session.providerId,
				sdkSessionId: session.sdkSessionId,
			}),
		),
	);
	statuses.sort(compareCodingStatusRecency);
	if (listOptions.value.json) {
		console.log(
			JSON.stringify(
				{
					repositories: repositories.map(toCodingRepositoryJson),
					sessions: statuses.map(toCodingStatusJson),
				},
				null,
				"\t",
			),
		);
		process.exit(0);
	}
	printCodingList(repositories, statuses, listOptions.value.by);
	process.exit(0);
}

function parseCodingListOptions(args: string[]):
	| {
			status: "valid";
			value: {
				all: boolean;
				by: "recent" | "repo";
				json: boolean;
				repo?: string;
			};
	  }
	| { status: "invalid"; message: string } {
	let all = false;
	let by: "recent" | "repo" = "recent";
	let json = false;
	let repo: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--all") {
			all = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--repo") {
			const value = args[index + 1];
			if (!value) {
				return { status: "invalid", message: "Missing --repo value" };
			}
			repo = value;
			index += 1;
			continue;
		}
		if (arg === "--by") {
			const value = args[index + 1];
			if (value !== "repo" && value !== "recent") {
				return { status: "invalid", message: "Use --by repo or --by recent" };
			}
			by = value;
			index += 1;
			continue;
		}
		return {
			status: "invalid",
			message: formatCodingListUsage(),
		};
	}
	return {
		status: "valid",
		value: { all, by, json, ...(repo ? { repo } : {}) },
	};
}

async function codingCancelCommand(options: CodingCommandOptions) {
	const args = options.argv.slice(4);
	if (isHelpFlag(args[0])) {
		console.log(formatCodingCancelUsage());
		process.exit(0);
	}

	const sessionRef = args[0];
	if (!sessionRef || args.length !== 1) {
		console.error(formatCodingCancelUsage());
		process.exit(1);
	}

	const ref = parseExplicitSessionRef(sessionRef);
	if (!ref) {
		console.error("Coding session ref must use provider/session format");
		process.exit(1);
	}

	const result = await postCodingCancel(options.homeDir, ref);
	exitWithCodingCancelResult(result);
}

async function codingStatusCommand(options: CodingCommandOptions) {
	const args = options.argv.slice(4);
	if (isHelpFlag(args[0])) {
		console.log(formatCodingStatusUsage());
		process.exit(0);
	}

	const sessionRef = args[0];
	const statusOptions = parseCodingStatusOptions(args.slice(1));
	if (!sessionRef || statusOptions.status === "invalid") {
		console.error(
			statusOptions.status === "invalid"
				? statusOptions.message
				: formatCodingStatusUsage(),
		);
		process.exit(1);
	}

	const ref = parseExplicitSessionRef(sessionRef);
	if (!ref) {
		console.error("Coding session ref must use provider/session format");
		process.exit(1);
	}

	const chatContext = await resolveCodingChatContext(options);
	const result = statusOptions.value.block
		? await waitForCodingStatus(options.homeDir, ref, {
				chatContext,
				timeoutSeconds: statusOptions.value.timeoutSeconds,
			})
		: {
				status: "terminal" as const,
				value: await getCodingStatus(options.homeDir, ref, chatContext),
			};
	if (result.status === "timeout") {
		console.error(
			`coding status timed out after ${statusOptions.value.timeoutSeconds}s`,
		);
		process.exit(124);
	}
	if (statusOptions.value.json) {
		printCodingStatusJson(result.value);
	} else {
		printCodingStatus(result.value);
	}
	process.exit(0);
}

function parseCodingStatusOptions(args: string[]):
	| {
			status: "valid";
			value: { block: boolean; json: boolean; timeoutSeconds?: number };
	  }
	| { status: "invalid"; message: string } {
	let block = false;
	let json = false;
	let timeoutSeconds: number | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--block") {
			block = true;
			continue;
		}
		if (arg === "--timeout") {
			const value = args[index + 1];
			if (!value) {
				return { status: "invalid", message: formatCodingStatusUsage() };
			}
			const parsed = parsePositiveInteger(value);
			if (parsed === undefined) {
				return {
					status: "invalid",
					message: "Status timeout must be a positive integer",
				};
			}
			timeoutSeconds = parsed;
			index += 1;
			continue;
		}
		if (arg?.startsWith("--timeout=")) {
			const parsed = parsePositiveInteger(arg.slice("--timeout=".length));
			if (parsed === undefined) {
				return {
					status: "invalid",
					message: "Status timeout must be a positive integer",
				};
			}
			timeoutSeconds = parsed;
			continue;
		}
		return { status: "invalid", message: formatCodingStatusUsage() };
	}
	if (timeoutSeconds !== undefined && !block) {
		return {
			status: "invalid",
			message: "Use --timeout only with --block",
		};
	}
	return { status: "valid", value: { block, json, timeoutSeconds } };
}

async function codingTranscriptCommand(options: CodingCommandOptions) {
	const args = options.argv.slice(4);
	if (isHelpFlag(args[0])) {
		console.log(formatCodingTranscriptUsage());
		process.exit(0);
	}

	const sessionRef = args[0];
	const transcriptOptions = parseCodingTranscriptOptions(args.slice(1));
	if (!sessionRef || transcriptOptions.status === "invalid") {
		console.error(
			transcriptOptions.status === "invalid"
				? transcriptOptions.message
				: formatCodingTranscriptUsage(),
		);
		process.exit(1);
	}

	const ref = parseExplicitSessionRef(sessionRef);
	if (!ref) {
		console.error("Coding session ref must use provider/session format");
		process.exit(1);
	}

	const chatContext = await resolveCodingChatContext(options);
	await printCodingTranscript(options.homeDir, ref, {
		chatContext,
		...transcriptOptions.value,
	});
	process.exit(0);
}

function parseCodingTranscriptOptions(
	args: string[],
):
	| { status: "valid"; value: { full: boolean; turns: number } }
	| { status: "invalid"; message: string } {
	let full = false;
	let turns = 1;
	let turnsSet = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--full") {
			full = true;
			continue;
		}
		if (arg === "--turns") {
			const value = args[index + 1];
			if (!value) {
				return { status: "invalid", message: formatCodingTranscriptUsage() };
			}
			const parsed = parsePositiveInteger(value);
			if (parsed === undefined) {
				return {
					status: "invalid",
					message: "Transcript turn count must be a positive integer",
				};
			}
			turns = parsed;
			turnsSet = true;
			index += 1;
			continue;
		}
		if (arg?.startsWith("--turns=")) {
			const parsed = parsePositiveInteger(arg.slice("--turns=".length));
			if (parsed === undefined) {
				return {
					status: "invalid",
					message: "Transcript turn count must be a positive integer",
				};
			}
			turns = parsed;
			turnsSet = true;
			continue;
		}
		return { status: "invalid", message: formatCodingTranscriptUsage() };
	}
	if (full && turnsSet) {
		return {
			status: "invalid",
			message: "Use either --full or --turns, not both",
		};
	}
	return { status: "valid", value: { full, turns } };
}

function parsePositiveInteger(value: string): number | undefined {
	if (!/^[1-9]\d*$/.test(value)) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function codingTargetCommand(options: CodingCommandOptions) {
	const args = options.argv.slice(3);
	const target = args[0];
	const prompt = args.slice(1).join(" ").trim();
	if (!target || !prompt) {
		console.error(formatCodingUsage());
		process.exit(1);
	}

	const ref = parseExplicitSessionRef(target);
	const chatContext = await resolveCodingChatContext(options);
	if (ref && isKnownCodingProviderId(ref.providerId)) {
		const result = await postCodingResume(
			options.homeDir,
			ref,
			{ prompt },
			chatContext,
		);
		exitWithCodingResult(result);
	}

	const startBody = resolveStartBody(target, prompt);
	if ("cwd" in startBody) {
		const result = await postCodingStart(
			options.homeDir,
			startBody,
			chatContext,
		);
		exitWithCodingResult(result);
	}

	if (ref) {
		const result = await postCodingResume(
			options.homeDir,
			ref,
			{ prompt },
			chatContext,
		);
		exitWithCodingResult(result);
	}

	const result = await postCodingStart(options.homeDir, startBody, chatContext);
	exitWithCodingResult(result);
}

function resolveStartBody(target: string, prompt: string): CodingStartBody {
	const cwd = resolve(target);
	if (existsSync(cwd)) {
		return { cwd, prompt };
	}
	return { repositoryId: target, prompt };
}

function parseExplicitSessionRef(
	sessionRef: string,
): { providerId: string; sdkSessionId: string } | undefined {
	const slashIndex = sessionRef.indexOf("/");
	if (slashIndex <= 0 || slashIndex === sessionRef.length - 1) {
		return undefined;
	}
	return {
		providerId: sessionRef.slice(0, slashIndex),
		sdkSessionId: sessionRef.slice(slashIndex + 1),
	};
}

function isKnownCodingProviderId(providerId: string): boolean {
	return providerId === "codex";
}

async function resolveCodingChatContext(
	options: CodingCommandOptions,
): Promise<CodingChatContext | undefined> {
	const sender = resolveSenderAgent(options.homeDir, process.cwd());
	if (!sender) {
		return undefined;
	}
	try {
		const result = await getJson<BrowserAgentActiveSessionResponse>(
			options.homeDir,
			`/api/agents/${encodeURIComponent(sender.agentId)}/active-session`,
		);
		if (!result.activeSession) {
			return undefined;
		}
		return {
			chatAgentId: sender.agentId,
			chatProviderId: result.activeSession.providerId,
			chatSdkSessionId: result.activeSession.sdkSessionId,
		};
	} catch {
		return undefined;
	}
}

async function postCodingStart(
	homeDir: string,
	body: CodingStartBody,
	chatContext?: CodingChatContext,
): Promise<BrowserCodingSessionStartResponse> {
	return postJson(homeDir, "/api/coding/sessions", body, chatContext);
}

async function postCodingResume(
	homeDir: string,
	ref: { providerId: string; sdkSessionId: string },
	body: { prompt: string },
	chatContext?: CodingChatContext,
): Promise<BrowserCodingSessionResumeResponse> {
	return postJson(
		homeDir,
		`/api/coding/sessions/${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.sdkSessionId)}/resume`,
		body,
		chatContext,
	);
}

async function postCodingCancel(
	homeDir: string,
	ref: { providerId: string; sdkSessionId: string },
): Promise<BrowserCodingSessionCancelResponse> {
	return postJson(
		homeDir,
		`/api/coding/sessions/${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.sdkSessionId)}/cancel`,
		{},
	);
}

async function getCodingRepositories(
	homeDir: string,
	options: { includeArchived: boolean },
): Promise<BrowserCodingRepositoryListResponse> {
	const params = new URLSearchParams();
	if (options.includeArchived) {
		params.set("includeArchived", "true");
	}
	const query = params.size > 0 ? `?${params}` : "";
	return getJson(homeDir, `/api/coding/repositories${query}`);
}

async function getCodingListSessions(
	homeDir: string,
	options: { all: boolean; repositoryId?: string },
): Promise<BrowserCodingSessionPageResponse["sessions"]> {
	const open = await getCodingSessionPage(homeDir, {
		repositoryId: options.repositoryId,
	});
	if (!options.all) {
		return open.sessions;
	}
	const archived = await getCodingSessionPage(homeDir, {
		lifecycleStatus: "archived",
		repositoryId: options.repositoryId,
	});
	return [...open.sessions, ...archived.sessions];
}

async function getCodingSessionPage(
	homeDir: string,
	options: { lifecycleStatus?: "archived"; repositoryId?: string },
): Promise<BrowserCodingSessionPageResponse> {
	const params = new URLSearchParams();
	params.set("limit", "100");
	if (options.lifecycleStatus) {
		params.set("lifecycleStatus", options.lifecycleStatus);
	}
	if (options.repositoryId) {
		params.set("repositoryId", options.repositoryId);
	}
	return getJson(homeDir, `/api/coding/sessions?${params}`);
}

async function getCodingStatus(
	homeDir: string,
	ref: { providerId: string; sdkSessionId: string },
	chatContext?: CodingChatContext,
): Promise<BrowserCodingSessionStatusResponse> {
	return getJson(
		homeDir,
		`/api/coding/sessions/${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.sdkSessionId)}/status`,
		chatContext,
	);
}

async function waitForCodingStatus(
	homeDir: string,
	ref: { providerId: string; sdkSessionId: string },
	options: { chatContext?: CodingChatContext; timeoutSeconds?: number },
): Promise<
	| { status: "terminal"; value: BrowserCodingSessionStatusResponse }
	| { status: "timeout" }
> {
	const deadline =
		options.timeoutSeconds === undefined
			? undefined
			: Date.now() + options.timeoutSeconds * 1000;
	while (true) {
		const status = await getCodingStatus(homeDir, ref, options.chatContext);
		if (status.state !== "running") {
			return { status: "terminal", value: status };
		}
		const now = Date.now();
		if (deadline !== undefined && now >= deadline) {
			return { status: "timeout" };
		}
		const delayMs =
			deadline === undefined ? 250 : Math.min(250, Math.max(0, deadline - now));
		if (delayMs === 0) {
			return { status: "timeout" };
		}
		await sleep(delayMs);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson<TResponse>(
	homeDir: string,
	path: string,
	body: unknown,
	chatContext?: CodingChatContext,
): Promise<TResponse> {
	return requestJson(homeDir, path, {
		body: JSON.stringify(body),
		headers: {
			"content-type": "application/json",
			...codingChatContextHeaders(chatContext),
		},
		method: "POST",
	});
}

async function getJson<TResponse>(
	homeDir: string,
	path: string,
	chatContext?: CodingChatContext,
): Promise<TResponse> {
	return requestJson(homeDir, path, {
		headers: codingChatContextHeaders(chatContext),
		method: "GET",
	});
}

async function requestJson<TResponse>(
	homeDir: string,
	path: string,
	init: RequestInit,
): Promise<TResponse> {
	const url = codingApiUrl(homeDir, path);
	const response = await fetch(url, init);
	const text = await response.text();
	let data: unknown;
	try {
		data = text ? (JSON.parse(text) as unknown) : undefined;
	} catch {
		if (!response.ok) {
			throw new Error(`Coding request failed: ${response.status}`);
		}
		throw new Error("Coding request returned invalid JSON");
	}
	if (!response.ok) {
		const message =
			typeof data === "object" &&
			data !== null &&
			"error" in data &&
			typeof data.error === "string"
				? data.error
				: `Coding request failed: ${response.status}`;
		throw new Error(message);
	}
	return data as TResponse;
}

function codingChatContextHeaders(
	chatContext: CodingChatContext | undefined,
): Record<string, string> {
	if (!chatContext) {
		return {};
	}
	return {
		"x-outclaw-chat-agent-id": chatContext.chatAgentId,
		"x-outclaw-chat-provider-id": chatContext.chatProviderId,
		"x-outclaw-chat-session-id": chatContext.chatSdkSessionId,
	};
}

async function printCodingTranscript(
	homeDir: string,
	ref: { providerId: string; sdkSessionId: string },
	options: {
		chatContext?: CodingChatContext;
		full: boolean;
		turns: number;
	},
) {
	const abortController = new AbortController();
	const events: CodingSessionEvent[] = [];
	for await (const item of streamCodingSessionEvents(homeDir, ref, {
		chatContext: options.chatContext,
		follow: false,
		signal: abortController.signal,
	})) {
		if (isRenderableCodingEvent(item.event)) {
			events.push(item.event);
		}
	}
	const selected = options.full
		? events
		: selectLatestInteractionTurns(events, options.turns);
	const renderer = new CodingTranscriptRenderer((chunk) => {
		process.stdout.write(chunk);
	});
	for (const event of selected) {
		renderer.render(event);
	}
	renderer.finish();
}

function selectLatestInteractionTurns(
	events: CodingSessionEvent[],
	turns: number,
): CodingSessionEvent[] {
	const ranges: Array<{ start: number }> = [];
	let activeStart: number | undefined;
	for (const [index, event] of events.entries()) {
		if (event.type === "user_prompt" && activeStart === undefined) {
			activeStart = index;
			continue;
		}
		if (activeStart !== undefined && isTerminalCodingEvent(event)) {
			ranges.push({ start: activeStart });
			activeStart = undefined;
		}
	}
	if (activeStart !== undefined) {
		ranges.push({ start: activeStart });
	}
	if (ranges.length === 0) {
		return events;
	}
	const selectedTurnIndex = Math.max(0, ranges.length - turns);
	const selectedRange = ranges[selectedTurnIndex];
	return selectedRange ? events.slice(selectedRange.start) : events;
}

function isTerminalCodingEvent(event: CodingSessionEvent): boolean {
	return event.type === "done" || event.type === "error";
}

interface CodingSessionStreamItem {
	providerId: string;
	sdkSessionId: string;
	sequence: number;
	event: CodingSessionEvent;
	createdAt: number;
}

async function* streamCodingSessionEvents(
	homeDir: string,
	ref: { providerId: string; sdkSessionId: string },
	options: {
		chatContext?: CodingChatContext;
		follow: boolean;
		signal: AbortSignal;
	},
): AsyncIterable<CodingSessionStreamItem> {
	const params = new URLSearchParams();
	if (!options.follow) {
		params.set("follow", "false");
	}
	const query = params.size > 0 ? `?${params}` : "";
	const path = `/api/coding/sessions/${encodeURIComponent(ref.providerId)}/${encodeURIComponent(ref.sdkSessionId)}/events${query}`;
	const response = await fetch(codingApiUrl(homeDir, path), {
		headers: codingChatContextHeaders(options.chatContext),
		method: "GET",
		signal: options.signal,
	});
	if (!response.ok) {
		throw new Error(await readCodingError(response));
	}
	if (!response.body) {
		throw new Error("Coding transcript stream returned no body");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (!options.signal.aborted) {
			const result = await reader.read();
			if (result.done) {
				break;
			}
			buffer += decoder.decode(result.value, { stream: true });
			let frameEnd = buffer.indexOf("\n\n");
			while (frameEnd !== -1) {
				const frame = buffer.slice(0, frameEnd);
				buffer = buffer.slice(frameEnd + 2);
				const item = parseCodingSseFrame(frame);
				if (item) {
					yield item;
				}
				frameEnd = buffer.indexOf("\n\n");
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

function parseCodingSseFrame(
	frame: string,
): CodingSessionStreamItem | undefined {
	let eventName = "message";
	const dataLines: string[] = [];
	for (const rawLine of frame.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (line.startsWith("event:")) {
			eventName = line.slice("event:".length).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(removeOneLeadingSpace(line.slice("data:".length)));
		}
	}
	if (dataLines.length === 0) {
		return undefined;
	}
	const dataText = dataLines.join("\n");
	const data = JSON.parse(dataText) as unknown;
	if (eventName === "error") {
		throw new Error(readMessage(data) ?? "Coding transcript stream failed");
	}
	return data as CodingSessionStreamItem;
}

function removeOneLeadingSpace(value: string): string {
	return value.startsWith(" ") ? value.slice(1) : value;
}

async function readCodingError(response: Response): Promise<string> {
	const text = await response.text();
	if (!text) {
		return `Coding request failed: ${response.status}`;
	}
	try {
		const data = JSON.parse(text) as unknown;
		return readMessage(data) ?? `Coding request failed: ${response.status}`;
	} catch {
		return `Coding request failed: ${response.status}`;
	}
}

function readMessage(data: unknown): string | undefined {
	if (
		typeof data === "object" &&
		data !== null &&
		"message" in data &&
		typeof data.message === "string"
	) {
		return data.message;
	}
	if (
		typeof data === "object" &&
		data !== null &&
		"error" in data &&
		typeof data.error === "string"
	) {
		return data.error;
	}
	return undefined;
}

function codingApiUrl(homeDir: string, path: string): URL {
	const config = loadGlobalConfig(homeDir);
	const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
	return new URL(path, `http://${host}:${config.port}`);
}

function printCodingStatus(result: BrowserCodingSessionStatusResponse) {
	if (result.state === "running") {
		console.log("running");
		return;
	}
	if (result.state === "error") {
		console.log(`error: ${readCodingStatusError(result)}`);
		return;
	}
	if (result.state === "cancelled") {
		console.log("cancelled");
		return;
	}
	console.log("done");
	if (result.finalResponse?.trim()) {
		console.log("");
		console.log(result.finalResponse.trim());
	}
}

function printCodingStatusJson(result: BrowserCodingSessionStatusResponse) {
	console.log(JSON.stringify(toCodingStatusJson(result), null, "\t"));
}

function toCodingStatusJson(
	result: BrowserCodingSessionStatusResponse,
): Record<string, unknown> {
	return {
		ref: result.ref ?? `${result.providerId}/${result.sdkSessionId}`,
		state: result.state,
		...(result.repo ? { repo: result.repo } : {}),
		...(result.startedAt ? { started_at: result.startedAt } : {}),
		...(result.lastEventAt ? { last_event_at: result.lastEventAt } : {}),
		...(result.durationMs !== undefined
			? { duration_ms: result.durationMs }
			: {}),
		...(result.lastPrompt ? { last_prompt: result.lastPrompt } : {}),
		...(result.finalResponse ? { final_response: result.finalResponse } : {}),
		...(result.state === "error"
			? { error: { message: readCodingStatusError(result) } }
			: {}),
	};
}

function toCodingRepositoryJson(
	repository: BrowserCodingRepositorySummary,
): Record<string, unknown> {
	return {
		id: repository.id,
		root_cwd: repository.rootCwd,
		display_name: repository.displayName,
		source: repository.source,
		status: repository.status,
		created_at: new Date(repository.createdAt).toISOString(),
		last_active: new Date(repository.lastActive).toISOString(),
		...(repository.remoteUrl ? { remote_url: repository.remoteUrl } : {}),
		...(repository.archivedAt
			? { archived_at: new Date(repository.archivedAt).toISOString() }
			: {}),
	};
}

interface CodingRepositoryFilter {
	repositoryId?: string;
	rootCwd?: string;
	unknown?: string;
}

function resolveCodingRepositoryFilter(
	value: string | undefined,
	repositories: BrowserCodingRepositorySummary[],
): CodingRepositoryFilter | undefined {
	if (!value) {
		return undefined;
	}
	if (!isCodingRepositoryPathFilter(value)) {
		const repository = repositories.find((candidate) => candidate.id === value);
		return repository
			? { repositoryId: repository.id, rootCwd: repository.rootCwd }
			: { unknown: value };
	}
	const absolute = resolve(value);
	const repository = repositories.find(
		(candidate) => resolve(candidate.rootCwd) === absolute,
	);
	return repository
		? { repositoryId: repository.id, rootCwd: repository.rootCwd }
		: { unknown: value };
}

function isCodingRepositoryPathFilter(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		existsSync(resolve(value))
	);
}

function filterCodingRepositories(
	repositories: BrowserCodingRepositorySummary[],
	filter: CodingRepositoryFilter | undefined,
): BrowserCodingRepositorySummary[] {
	if (!filter) {
		return repositories;
	}
	return repositories.filter((repository) => {
		if (filter.repositoryId) {
			return repository.id === filter.repositoryId;
		}
		return filter.rootCwd
			? resolve(repository.rootCwd) === filter.rootCwd
			: true;
	});
}

function compareCodingStatusRecency(
	left: BrowserCodingSessionStatusResponse,
	right: BrowserCodingSessionStatusResponse,
): number {
	const leftTime = left.lastEventAt ? Date.parse(left.lastEventAt) : 0;
	const rightTime = right.lastEventAt ? Date.parse(right.lastEventAt) : 0;
	return rightTime - leftTime;
}

function printCodingList(
	repositories: BrowserCodingRepositorySummary[],
	statuses: BrowserCodingSessionStatusResponse[],
	by: "recent" | "repo",
) {
	if (statuses.length === 0 && repositories.length === 0) {
		console.log("No coding sessions or repositories.");
		return;
	}
	if (by === "repo") {
		printCodingListByRepository(repositories, statuses);
		return;
	}
	printRecentCodingList(statuses);
	const sessionRepos = new Set(statuses.map((status) => status.repo));
	const emptyRepositories = repositories.filter(
		(repository) => !sessionRepos.has(repository.rootCwd),
	);
	if (emptyRepositories.length > 0) {
		if (statuses.length > 0) {
			console.log("");
		}
		console.log("Registered repositories:");
		for (const repository of emptyRepositories) {
			console.log(
				`${repository.id}\t${repository.status}\t${repository.rootCwd}`,
			);
		}
	}
}

function printRecentCodingList(statuses: BrowserCodingSessionStatusResponse[]) {
	if (statuses.length === 0) {
		return;
	}
	console.log("REF\tSTATE\tREPO\tLAST PROMPT");
	for (const status of statuses) {
		console.log(
			`${status.ref ?? `${status.providerId}/${status.sdkSessionId}`}\t${status.state}\t${status.repo ?? ""}\t${truncateTableCell(status.lastPrompt ?? "", 60)}`,
		);
	}
}

function printCodingListByRepository(
	repositories: BrowserCodingRepositorySummary[],
	statuses: BrowserCodingSessionStatusResponse[],
) {
	const byRepo = new Map<string, BrowserCodingSessionStatusResponse[]>();
	for (const status of statuses) {
		const key = status.repo ?? "";
		byRepo.set(key, [...(byRepo.get(key) ?? []), status]);
	}
	for (const repository of repositories) {
		console.log(
			`${repository.rootCwd} (${repository.id}, ${repository.status})`,
		);
		const sessions = byRepo.get(repository.rootCwd) ?? [];
		for (const status of sessions) {
			console.log(
				`  ${status.ref ?? `${status.providerId}/${status.sdkSessionId}`}\t${status.state}\t${truncateTableCell(status.lastPrompt ?? "", 60)}`,
			);
		}
	}
}

function truncateTableCell(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function readCodingStatusError(
	result: BrowserCodingSessionStatusResponse,
): string {
	if (typeof result.error === "string") {
		return result.error;
	}
	return result.error?.message ?? "Coding session failed";
}

class CodingTranscriptRenderer {
	private readonly commandOutputSeen = new Set<string>();
	private lastOutputEndedWithNewline = true;
	private pendingThinking = "";
	private wroteAny = false;

	constructor(private readonly write: (chunk: string) => void) {}

	render(event: CodingSessionEvent) {
		if (event.type === "thinking") {
			this.pendingThinking += event.text;
			return;
		}
		this.flushThinking();
		switch (event.type) {
			case "user_prompt":
				this.writeBlock(`[user] ${event.text.trim()}`);
				break;
			case "session_initialized":
				this.writeBlock(`[session] ${event.sessionId}`);
				break;
			case "text":
				this.writeRaw(event.text);
				break;
			case "status":
				this.writeBlock(`[status] ${event.message}`);
				break;
			case "command_execution_started":
				this.writeBlock(`[command] ${event.command}`);
				break;
			case "command_execution_output":
				this.commandOutputSeen.add(event.callId);
				this.writeRaw(event.output);
				break;
			case "command_execution_completed":
				if (event.output && !this.commandOutputSeen.has(event.callId)) {
					this.writeRaw(event.output);
				}
				this.writeBlock(`[command exited ${event.exitCode ?? "unknown"}]`);
				break;
			case "file_change_applied":
				if (event.changes.length === 0) {
					this.writeBlock("[file] no changes");
					break;
				}
				for (const change of event.changes) {
					const moveSuffix = change.movePath ? ` -> ${change.movePath}` : "";
					this.writeBlock(`[file] ${change.kind} ${change.path}${moveSuffix}`);
				}
				break;
			case "web_search_started":
				this.writeBlock(`[web-search] ${event.query ?? "started"}`);
				break;
			case "web_search_completed":
				this.writeBlock(
					`[web-search done] ${event.query ?? event.queries?.join(", ") ?? "completed"}`,
				);
				break;
			case "subagent_tool_started":
				this.writeBlock(`[subagent] ${event.operation}`);
				if (event.prompt) {
					this.writeBlock(`  prompt: ${event.prompt}`);
				}
				break;
			case "subagent_tool_completed":
				this.writeBlock(
					`[subagent done] ${event.operation}${event.status ? ` ${event.status}` : ""}`,
				);
				break;
			case "tool_call_started":
				this.writeBlock(`[tool] ${event.toolKind}`);
				this.writeDetails(event.details);
				break;
			case "tool_call_completed":
				this.writeBlock(
					`[tool done] ${event.toolKind}${event.status ? ` ${event.status}` : ""}`,
				);
				this.writeDetails(event.details);
				break;
			case "compacting_started":
				this.writeBlock("[compacting] started");
				break;
			case "compacting_finished":
				this.writeBlock("[compacting] finished");
				break;
			case "error":
				this.writeBlock(`[error] ${event.message}`);
				break;
			case "done":
				this.writeBlock(`[done] ${formatDuration(event.durationMs)}`);
				break;
			case "image":
				this.writeBlock(`[image] ${event.path}`);
				break;
			case "usage_updated":
				break;
		}
	}

	finish() {
		this.flushThinking();
	}

	private flushThinking() {
		const text = this.pendingThinking.trim();
		this.pendingThinking = "";
		if (text) {
			this.writeBlock(`[thinking] ${text}`);
		}
	}

	private writeDetails(
		details: Array<{ label: string; value: string }> | undefined,
	) {
		for (const detail of details ?? []) {
			this.writeBlock(`  ${detail.label}: ${detail.value}`);
		}
	}

	private writeBlock(line: string) {
		if (this.wroteAny && !this.lastOutputEndedWithNewline) {
			this.write("\n");
		}
		this.write(`${line}\n`);
		this.wroteAny = true;
		this.lastOutputEndedWithNewline = true;
	}

	private writeRaw(chunk: string) {
		if (!chunk) {
			return;
		}
		this.write(chunk);
		this.wroteAny = true;
		this.lastOutputEndedWithNewline = chunk.endsWith("\n");
	}
}

function isRenderableCodingEvent(event: CodingSessionEvent): boolean {
	return event.type !== "usage_updated" && event.type !== "session_initialized";
}

function formatDuration(durationMs: number): string {
	if (durationMs < 1000) {
		return `${durationMs}ms`;
	}
	const seconds = durationMs / 1000;
	return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
}

function exitWithCodingResult(
	result:
		| BrowserCodingSessionStartResponse
		| BrowserCodingSessionResumeResponse,
) {
	if (result.status === "rejected") {
		console.error(result.message);
		process.exit(1);
	}
	console.log(`${result.providerId}/${result.sdkSessionId}`);
	process.exit(0);
}

function exitWithCodingCancelResult(
	result: BrowserCodingSessionCancelResponse,
) {
	if (result.status === "rejected") {
		console.error(result.message);
		process.exit(1);
	}
	if (result.status === "already_terminal") {
		console.log(
			`session is already ${result.state}: ${result.providerId}/${result.sdkSessionId}`,
		);
		process.exit(0);
	}
	console.log(`${result.providerId}/${result.sdkSessionId}`);
	process.exit(0);
}
