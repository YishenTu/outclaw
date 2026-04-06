import { ClaudeAdapter } from "../backend/adapters/claude.ts";
import type { Facade } from "../backend/types.ts";

interface RuntimeOptions {
	port: number;
	facade?: Facade;
	cwd?: string;
}

// biome-ignore lint/complexity/noBannedTypes: Bun WS generic requires object type
type WsClient = import("bun").ServerWebSocket<{}>;

export function createRuntime(options: RuntimeOptions) {
	const facade = options.facade ?? new ClaudeAdapter();
	const clients = new Set<WsClient>();
	let activeSessionId: string | undefined;

	// biome-ignore lint/complexity/noBannedTypes: Bun WS generic requires {}
	const server = Bun.serve<{}>({
		port: options.port,
		fetch(req, server) {
			if (server.upgrade(req, { data: {} })) {
				return;
			}
			return new Response("misanthropic runtime", { status: 200 });
		},
		websocket: {
			open(ws) {
				clients.add(ws);
			},
			close(ws) {
				clients.delete(ws);
			},
			async message(ws, message) {
				try {
					const data = JSON.parse(String(message));

					if (data.type === "command" && data.command === "/new") {
						activeSessionId = undefined;
						ws.send(JSON.stringify({ type: "session_cleared" }));
						return;
					}

					if (data.type === "prompt") {
						const isBroadcast = data.source === "telegram";

						// Notify other clients about the incoming prompt
						if (isBroadcast) {
							const userPrompt = JSON.stringify({
								type: "user_prompt",
								prompt: data.prompt,
								source: data.source,
							});
							for (const client of clients) {
								if (client !== ws) {
									client.send(userPrompt);
								}
							}
						}

						for await (const event of facade.run({
							prompt: data.prompt,
							resume: activeSessionId,
							cwd: options.cwd,
						})) {
							// Always send to the sender
							ws.send(JSON.stringify(event));

							// Broadcast to other clients if from telegram
							if (isBroadcast) {
								const serialized = JSON.stringify(event);
								for (const client of clients) {
									if (client !== ws) {
										client.send(serialized);
									}
								}
							}

							if (event.type === "done") {
								activeSessionId = event.sessionId;
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
		port: server.port as number,
		stop() {
			server.stop();
		},
	};
}
