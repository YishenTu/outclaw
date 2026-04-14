import {
	type ImageEvent,
	type ImageRef,
	parseMessage,
	type ReplyContext,
} from "../../../common/protocol.ts";
import {
	closeRuntimeSocket,
	openRuntimeSocket,
	type RuntimeSocketConnectOptions,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../../runtime-client/index.ts";

export type StreamChunk =
	| { type: "thinking"; text: string }
	| { type: "text"; text: string }
	| { type: "compacting_started" }
	| { type: "compacting_finished" };

export type TelegramBridgeRouting = RuntimeSocketConnectOptions;

export function createTelegramBridge(url: string) {
	const sockets = new Set<WebSocket>();

	function createSocket(routing?: TelegramBridgeRouting) {
		const socket = openRuntimeSocket(url, "telegram", undefined, routing);
		const { ws } = socket;
		sockets.add(ws);
		ws.addEventListener("close", () => {
			sockets.delete(ws);
		});
		return socket;
	}

	function closeSocket(ws: WebSocket) {
		sockets.delete(ws);
		closeRuntimeSocket(ws);
	}

	return {
		async send(
			prompt: string,
			onText?: (accumulated: string) => void,
			images?: ImageRef[],
			telegramChatId?: number,
			replyContext?: ReplyContext,
			routing?: TelegramBridgeRouting,
		): Promise<string> {
			const { ws, ready } = createSocket(routing);
			await ready;

			return new Promise<string>((resolve, reject) => {
				let text = "";
				let settled = false;

				const rejectOnce = (error: Error) => {
					if (settled) return;
					settled = true;
					closeSocket(ws);
					reject(error);
				};

				const resolveOnce = (value: string) => {
					if (settled) return;
					settled = true;
					closeSocket(ws);
					resolve(value);
				};

				ws.onmessage = (msg) => {
					const event = parseMessage(msg.data as string) as {
						type: string;
						text?: string;
						message?: string;
					};
					if (event.type === "text" && event.text) {
						text += event.text;
						onText?.(text);
					} else if (event.type === "status") {
						rejectOnce(
							new Error(
								typeof event.message === "string"
									? event.message
									: "Unexpected status event",
							),
						);
					} else if (event.type === "error") {
						rejectOnce(new Error(event.message ?? "Unknown error"));
					} else if (event.type === "done") {
						resolveOnce(text);
					}
				};

				ws.onerror = () => {
					rejectOnce(new Error("WebSocket error"));
				};

				ws.onclose = () => {
					if (settled) return;
					settled = true;
					reject(new Error("WebSocket closed"));
				};

				sendRuntimePrompt(
					ws,
					prompt,
					"telegram",
					images,
					telegramChatId,
					replyContext,
				);
			});
		},

		async sendCommandAndWait(
			command: string,
			expectedTypes?: ReadonlySet<string>,
			routing?: TelegramBridgeRouting,
		): Promise<{ type: string; [key: string]: unknown }> {
			const { ws, ready } = createSocket(routing);
			await ready;
			return new Promise((resolve, reject) => {
				let settled = false;

				const rejectOnce = (error: Error) => {
					if (settled) return;
					settled = true;
					closeSocket(ws);
					reject(error);
				};

				const resolveOnce = (event: {
					type: string;
					[key: string]: unknown;
				}) => {
					if (settled) return;
					settled = true;
					closeSocket(ws);
					resolve(event);
				};

				ws.onmessage = (msg) => {
					const event = parseMessage(msg.data as string) as {
						type: string;
						[key: string]: unknown;
					};
					// Skip unsolicited runtime_status (sent on connect);
					// allow through when explicitly requested via /status.
					if (event.type === "runtime_status" && !event.requested) return;
					// Always accept error events; skip everything else
					// that isn't in the expected set.
					if (event.type !== "error") {
						if (expectedTypes) {
							if (!expectedTypes.has(event.type)) return;
						} else if (
							event.type === "history_replay" ||
							event.type === "image" ||
							event.type === "text" ||
							event.type === "done" ||
							event.type === "user_prompt"
						) {
							return;
						}
					}
					resolveOnce(event);
				};
				ws.onerror = () => {
					rejectOnce(new Error("WebSocket error"));
				};
				ws.onclose = () => {
					if (settled) return;
					settled = true;
					reject(new Error("WebSocket closed"));
				};
				sendRuntimeCommand(ws, command);
			});
		},

		async *stream(
			prompt: string,
			images?: ImageRef[],
			onImage?: (event: ImageEvent) => void | Promise<void>,
			telegramChatId?: number,
			replyContext?: ReplyContext,
			routing?: TelegramBridgeRouting,
		): AsyncIterable<StreamChunk> {
			const { ws, ready } = createSocket(routing);
			await ready;

			let resolve: ((value: IteratorResult<StreamChunk>) => void) | null = null;
			let done = false;
			let error: Error | null = null;
			let pendingImageWork = Promise.resolve();
			const pending: StreamChunk[] = [];

			const enqueue = (chunk: StreamChunk) => {
				if (resolve) {
					const r = resolve;
					resolve = null;
					r({ value: chunk, done: false });
				} else {
					pending.push(chunk);
				}
			};

			const finishWithError = (err: Error) => {
				error = err;
				done = true;
				closeSocket(ws);
				if (resolve) {
					const r = resolve;
					resolve = null;
					r({
						value: undefined as unknown as StreamChunk,
						done: true,
					});
				}
			};

			ws.onmessage = (msg) => {
				const event = parseMessage(msg.data as string) as {
					type: string;
					text?: string;
					message?: string;
					path?: string;
					caption?: string;
				};
				if (event.type === "compacting_started") {
					enqueue({ type: "compacting_started" });
				} else if (event.type === "compacting_finished") {
					enqueue({ type: "compacting_finished" });
				} else if (event.type === "thinking" && event.text) {
					enqueue({ type: "thinking", text: event.text });
				} else if (event.type === "text" && event.text) {
					enqueue({ type: "text", text: event.text });
				} else if (event.type === "image" && event.path) {
					if (!onImage) {
						return;
					}
					pendingImageWork = pendingImageWork
						.then(() =>
							onImage({
								type: "image",
								path: event.path as string,
								caption:
									typeof event.caption === "string" ? event.caption : undefined,
							}),
						)
						.catch((err) => {
							finishWithError(
								err instanceof Error ? err : new Error(String(err)),
							);
						});
				} else if (event.type === "error") {
					finishWithError(new Error(event.message ?? "Unknown error"));
				} else if (event.type === "status") {
					finishWithError(
						new Error(
							typeof event.message === "string"
								? event.message
								: "Unexpected status event",
						),
					);
				} else if (event.type === "done") {
					done = true;
					closeSocket(ws);
					if (resolve) {
						const r = resolve;
						resolve = null;
						r({
							value: undefined as unknown as StreamChunk,
							done: true,
						});
					}
				}
			};
			ws.onerror = () => {
				finishWithError(new Error("WebSocket error"));
			};
			ws.onclose = () => {
				if (done) return;
				finishWithError(new Error("WebSocket closed"));
			};

			sendRuntimePrompt(
				ws,
				prompt,
				"telegram",
				images,
				telegramChatId,
				replyContext,
			);

			while (true) {
				if (pending.length > 0) {
					yield pending.shift() as StreamChunk;
					continue;
				}
				if (done) break;
				const result = await new Promise<IteratorResult<StreamChunk>>((r) => {
					resolve = r;
				});
				if (result.done) break;
				yield result.value;
			}
			await pendingImageWork;
			if (error) throw error;
		},

		close() {
			for (const ws of sockets) {
				closeSocket(ws);
			}
		},
	};
}
