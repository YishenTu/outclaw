import {
	extractError,
	type Facade,
	type FacadeEvent,
	type ImageRef,
	type ProviderModelInfo,
	type RunParams,
} from "../../../common/protocol.ts";
import {
	type CodexAppServerClientOptions,
	createCodexAppServerClient,
} from "./app-server-client.ts";
import { CodexNotificationQueue } from "./notification-queue.ts";
import { normalizeCodexTurnNotifications } from "./stream-normalizer.ts";
import type {
	CodexAppServerClient,
	CodexModelListResponse,
	CodexThreadResumeResult,
	CodexThreadStartResult,
	CodexTurnStartResult,
	CodexUserInput,
} from "./types.ts";

interface CodexAdapterOptions {
	client?: CodexAppServerClient;
	appServer?: CodexAppServerClientOptions;
}

export class CodexAdapter implements Facade {
	readonly providerId = "codex";
	private readonly injectedClient?: CodexAppServerClient;
	private readonly appServerOptions?: CodexAppServerClientOptions;
	private cachedClient?: CodexAppServerClient;

	constructor(options: CodexAdapterOptions = {}) {
		this.injectedClient = options.client;
		this.appServerOptions = options.appServer;
	}

	async dispose(): Promise<void> {
		const client = this.cachedClient ?? this.injectedClient;
		this.cachedClient = undefined;
		await client?.dispose?.();
	}

	async listModels(): Promise<ProviderModelInfo[]> {
		const client = await this.loadClient();
		await client.initialize();
		const models: ProviderModelInfo[] = [];
		let cursor: string | undefined;
		do {
			const response = await client.request<CodexModelListResponse>(
				"model/list",
				cursor === undefined ? {} : { cursor },
			);
			for (const entry of response.data) {
				if (entry.hidden) {
					continue;
				}
				models.push({
					id: entry.id,
					model: entry.model,
					displayName: entry.displayName,
					description: entry.description,
					isDefault: entry.isDefault,
					defaultReasoningEffort: entry.defaultReasoningEffort,
					supportedReasoningEfforts: entry.supportedReasoningEfforts.map(
						(effort) => effort.reasoningEffort,
					),
					serviceTiers: (entry.serviceTiers ?? []).map((tier) => ({
						id: tier.id,
						name: tier.name,
						description: tier.description,
					})),
				});
			}
			cursor = response.nextCursor ?? undefined;
		} while (cursor !== undefined);
		return models;
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		const startedAtMs = Date.now();
		const client = await this.loadClient();
		const queue = new CodexNotificationQueue();
		const unsubscribe = client.subscribe((notification) => {
			queue.push(notification);
		});
		let threadId: string | undefined;
		let turnId: string | undefined;
		let abortListener: (() => void) | undefined;

		try {
			await client.initialize();
			const threadResult = params.resume
				? await client.request<CodexThreadResumeResult>(
						"thread/resume",
						buildThreadResumeParams(params),
					)
				: await client.request<CodexThreadStartResult>(
						"thread/start",
						buildThreadStartParams(params),
					);

			threadId = threadResult.thread.id;
			yield {
				type: "session_initialized",
				sessionId: threadId,
			};

			const turnResult = await client.request<CodexTurnStartResult>(
				"turn/start",
				buildTurnStartParams(threadId, params),
			);
			turnId = turnResult.turn.id;

			abortListener = () => {
				void client
					.request("turn/interrupt", { threadId, turnId })
					.catch(() => {});
			};
			params.abortController?.signal.addEventListener("abort", abortListener, {
				once: true,
			});
			if (params.abortController?.signal.aborted) {
				abortListener();
			}

			yield* normalizeCodexTurnNotifications({
				notifications: queue,
				threadId,
				turnId,
				sessionId: threadId,
				startedAtMs,
			});
		} catch (err) {
			yield {
				type: "error",
				message: extractError(err),
				sessionId: threadId,
			};
		} finally {
			if (abortListener) {
				params.abortController?.signal.removeEventListener(
					"abort",
					abortListener,
				);
			}
			unsubscribe();
			queue.close();
		}
	}

	private async loadClient(): Promise<CodexAppServerClient> {
		if (this.injectedClient) {
			return this.injectedClient;
		}
		this.cachedClient ??= createCodexAppServerClient(this.appServerOptions);
		return this.cachedClient;
	}
}

function buildThreadStartParams(params: RunParams): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		experimentalRawEvents: false,
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.cwd) {
		payload.cwd = params.cwd;
	}
	if (params.systemPrompt) {
		payload.baseInstructions = params.systemPrompt;
	}
	if (params.ephemeral !== undefined) {
		payload.ephemeral = params.ephemeral;
	}
	if (params.serviceTier) {
		payload.serviceTier = params.serviceTier;
	}

	return payload;
}

function buildThreadResumeParams(params: RunParams): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		threadId: params.resume,
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.cwd) {
		payload.cwd = params.cwd;
	}
	if (params.systemPrompt) {
		payload.baseInstructions = params.systemPrompt;
	}
	if (params.serviceTier) {
		payload.serviceTier = params.serviceTier;
	}

	return payload;
}

function buildTurnStartParams(
	threadId: string,
	params: RunParams,
): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		threadId,
		input: buildUserInput(params.prompt, params.images),
	};

	if (params.model && isCodexCompatibleModel(params.model)) {
		payload.model = params.model;
	}
	if (params.effort) {
		payload.effort = params.effort;
	}
	if (params.serviceTier) {
		payload.serviceTier = params.serviceTier;
	}

	return payload;
}

function isCodexCompatibleModel(model: string): boolean {
	// The runtime currently resolves model aliases against the Claude registry,
	// so Codex calls would otherwise receive a Claude-side identifier and fail.
	// Codex falls back to its own config default when `model` is omitted.
	return model.startsWith("gpt-") || model.startsWith("codex");
}

function buildUserInput(prompt: string, images?: ImageRef[]): CodexUserInput[] {
	const input: CodexUserInput[] = [];

	for (const image of images ?? []) {
		input.push({
			type: "localImage",
			path: image.path,
		});
	}

	input.push({
		type: "text",
		text: prompt,
		text_elements: [],
	});

	return input;
}
