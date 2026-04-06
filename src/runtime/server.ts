import { ClaudeAdapter } from "../backend/adapters/claude.ts";
import type { Facade } from "../backend/types.ts";

interface RuntimeOptions {
	port: number;
	facade?: Facade;
}

export function createRuntime(options: RuntimeOptions) {
	const facade = options.facade ?? new ClaudeAdapter();

	const server = Bun.serve<{ sessionId?: string }>({
		port: options.port,
		fetch(req, server) {
			if (server.upgrade(req, { data: {} })) {
				return;
			}
			return new Response("misanthropic runtime", { status: 200 });
		},
		websocket: {
			async message(ws, message) {
				try {
					const data = JSON.parse(String(message));

					if (data.type === "prompt") {
						for await (const event of facade.run({
							prompt: data.prompt,
							resume: ws.data.sessionId,
						})) {
							ws.send(JSON.stringify(event));
							if (event.type === "done") {
								ws.data.sessionId = event.sessionId;
							}
						}
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					ws.send(JSON.stringify({ type: "error", message: msg }));
				}
			},
		},
	});

	return {
		port: server.port,
		stop() {
			server.stop();
		},
	};
}
