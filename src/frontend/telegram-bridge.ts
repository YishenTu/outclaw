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
					const event = JSON.parse(String(msg.data));
					if (event.type === "text") {
						text += event.text;
					} else if (event.type === "error") {
						reject(new Error(event.message));
					} else if (event.type === "done") {
						resolve(text);
					}
				};

				ws.onerror = () => reject(new Error("WebSocket error"));

				ws.send(JSON.stringify({ type: "prompt", prompt, source: "telegram" }));
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
