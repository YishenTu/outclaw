import {
	type ImageEvent,
	type ImageRef,
	parseMessage,
} from "../../common/protocol.ts";
import {
	closeRuntimeSocket,
	openRuntimeSocket,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../runtime-client/index.ts";

export function createTelegramBridge(url: string) {
	const sockets = new Set<WebSocket>();

	function createSocket() {
		const socket = openRuntimeSocket(url, "telegram");
		const { ws } = socket;
		sockets.add(ws);
		ws.onclose = () => {
			sockets.delete(ws);
		};
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
		): Promise<string> {
			const { ws, ready } = createSocket();
			await ready;

			return new Promise<string>((resolve, reject) => {
				let text = "";

				ws.onmessage = (msg) => {
					const event = parseMessage(msg.data as string) as {
						type: string;
						text?: string;
						message?: string;
					};
					if (event.type === "text" && event.text) {
						text += event.text;
						onText?.(text);
					} else if (event.type === "error") {
						closeSocket(ws);
						reject(new Error(event.message ?? "Unknown error"));
					} else if (event.type === "done") {
						closeSocket(ws);
						resolve(text);
					}
				};

				ws.onerror = () => {
					closeSocket(ws);
					reject(new Error("WebSocket error"));
				};

				sendRuntimePrompt(ws, prompt, "telegram", images, telegramChatId);
			});
		},

		async sendCommandAndWait(
			command: string,
			expectedTypes?: ReadonlySet<string>,
		): Promise<{ type: string; [key: string]: unknown }> {
			const { ws, ready } = createSocket();
			await ready;
			return new Promise((resolve, reject) => {
				ws.onmessage = (msg) => {
					const event = parseMessage(msg.data as string) as {
						type: string;
						[key: string]: unknown;
					};
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
					closeSocket(ws);
					resolve(event);
				};
				ws.onerror = () => {
					closeSocket(ws);
					reject(new Error("WebSocket error"));
				};
				sendRuntimeCommand(ws, command);
			});
		},

		async *stream(
			prompt: string,
			images?: ImageRef[],
			onImage?: (event: ImageEvent) => void | Promise<void>,
			telegramChatId?: number,
		): AsyncIterable<string> {
			const { ws, ready } = createSocket();
			await ready;

			let resolve: ((value: IteratorResult<string>) => void) | null = null;
			let done = false;
			let error: Error | null = null;
			let pendingImageWork = Promise.resolve();
			const pending: string[] = [];

			const finishWithError = (err: Error) => {
				error = err;
				done = true;
				closeSocket(ws);
				if (resolve) {
					const r = resolve;
					resolve = null;
					r({ value: undefined as unknown as string, done: true });
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
				if (event.type === "text" && event.text) {
					if (resolve) {
						const r = resolve;
						resolve = null;
						r({ value: event.text, done: false });
					} else {
						pending.push(event.text);
					}
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
				} else if (event.type === "done") {
					done = true;
					closeSocket(ws);
					if (resolve) {
						const r = resolve;
						resolve = null;
						r({ value: undefined as unknown as string, done: true });
					}
				}
			};
			ws.onerror = () => {
				finishWithError(new Error("WebSocket error"));
			};

			sendRuntimePrompt(ws, prompt, "telegram", images, telegramChatId);

			while (true) {
				if (pending.length > 0) {
					yield pending.shift() as string;
					continue;
				}
				if (done) break;
				const result = await new Promise<IteratorResult<string>>((r) => {
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
