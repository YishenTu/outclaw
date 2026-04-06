import { parseMessage, serialize } from "../../common/protocol.ts";

export function createTelegramBridge(url: string) {
	const sockets = new Set<WebSocket>();

	function createSocket() {
		const ws = new WebSocket(url);
		sockets.add(ws);

		const ready = new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve();
			ws.onerror = () => reject(new Error("WebSocket error"));
			ws.onclose = () => {
				sockets.delete(ws);
			};
		});

		return { ws, ready };
	}

	function closeSocket(ws: WebSocket) {
		sockets.delete(ws);
		if (
			ws.readyState === WebSocket.OPEN ||
			ws.readyState === WebSocket.CONNECTING
		) {
			ws.close();
		}
	}

	return {
		async send(
			prompt: string,
			onText?: (accumulated: string) => void,
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

				ws.send(serialize({ type: "prompt", prompt, source: "telegram" }));
			});
		},

		async sendCommandAndWait(
			command: string,
		): Promise<{ type: string; [key: string]: unknown }> {
			const { ws, ready } = createSocket();
			await ready;
			return new Promise((resolve, reject) => {
				ws.onmessage = (msg) => {
					const event = parseMessage(msg.data as string) as {
						type: string;
						[key: string]: unknown;
					};
					if (event.type === "history_replay") {
						return;
					}
					closeSocket(ws);
					resolve(event);
				};
				ws.onerror = () => {
					closeSocket(ws);
					reject(new Error("WebSocket error"));
				};
				ws.send(serialize({ type: "command", command }));
			});
		},

		async *stream(prompt: string): AsyncIterable<string> {
			const { ws, ready } = createSocket();
			await ready;

			let resolve: ((value: IteratorResult<string>) => void) | null = null;
			let done = false;
			let error: Error | null = null;
			const pending: string[] = [];

			ws.onmessage = (msg) => {
				const event = parseMessage(msg.data as string) as {
					type: string;
					text?: string;
					message?: string;
				};
				if (event.type === "text" && event.text) {
					if (resolve) {
						const r = resolve;
						resolve = null;
						r({ value: event.text, done: false });
					} else {
						pending.push(event.text);
					}
				} else if (event.type === "error") {
					error = new Error(event.message ?? "Unknown error");
					done = true;
					closeSocket(ws);
					if (resolve) {
						const r = resolve;
						resolve = null;
						r({ value: undefined as unknown as string, done: true });
					}
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
				error = new Error("WebSocket error");
				done = true;
				closeSocket(ws);
				if (resolve) {
					const r = resolve;
					resolve = null;
					r({ value: undefined as unknown as string, done: true });
				}
			};

			ws.send(serialize({ type: "prompt", prompt, source: "telegram" }));

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
			if (error) throw error;
		},

		close() {
			for (const ws of sockets) {
				closeSocket(ws);
			}
		},
	};
}
