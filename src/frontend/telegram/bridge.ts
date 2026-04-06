import { parseMessage, serialize } from "../../common/protocol.ts";

const TELEGRAM_MAX_LENGTH = 4096;

export function createTelegramBridge(url: string) {
	const ws = new WebSocket(url);
	let ready: Promise<void>;
	let resolveReady: () => void;

	ready = new Promise((resolve) => {
		resolveReady = resolve;
	});

	ws.onopen = () => resolveReady();

	return {
		async send(prompt: string): Promise<string> {
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
					} else if (event.type === "error") {
						reject(new Error(event.message ?? "Unknown error"));
					} else if (event.type === "done") {
						resolve(text);
					}
				};

				ws.onerror = () => reject(new Error("WebSocket error"));

				ws.send(serialize({ type: "prompt", prompt, source: "telegram" }));
			});
		},

		sendCommand(command: string) {
			ws.send(serialize({ type: "command", command }));
		},

		async sendCommandAndWait(
			command: string,
		): Promise<{ type: string; [key: string]: unknown }> {
			await ready;
			return new Promise((resolve) => {
				ws.onmessage = (msg) => {
					resolve(
						parseMessage(msg.data as string) as {
							type: string;
							[key: string]: unknown;
						},
					);
				};
				ws.send(serialize({ type: "command", command }));
			});
		},

		chunk(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
			if (text.length <= maxLength) return [text];

			const chunks: string[] = [];
			let remaining = text;
			while (remaining.length > 0) {
				chunks.push(remaining.slice(0, maxLength));
				remaining = remaining.slice(maxLength);
			}
			return chunks;
		},

		close() {
			ws.close();
		},
	};
}
