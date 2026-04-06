import { ClaudeAdapter } from "../backend/adapters/claude.ts";
import {
	extractError,
	type Facade,
	parseMessage,
	serialize,
} from "../common/protocol.ts";
import { SessionManager } from "./session.ts";

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
	const session = new SessionManager();

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
					const data = parseMessage(message as string) as {
						type: string;
						command?: string;
						prompt?: string;
						source?: string;
					};

					if (data.type === "command" && data.command === "/new") {
						session.clear();
						ws.send(serialize({ type: "session_cleared" }));
						return;
					}

					if (data.type === "prompt" && data.prompt) {
						const isBroadcast = data.source === "telegram";

						if (isBroadcast) {
							const userPrompt = serialize({
								type: "user_prompt",
								prompt: data.prompt,
								source: data.source ?? "unknown",
							});
							for (const client of clients) {
								if (client !== ws) {
									client.send(userPrompt);
								}
							}
						}

						for await (const event of facade.run({
							prompt: data.prompt,
							resume: session.id,
							cwd: options.cwd,
						})) {
							const serialized = serialize(event);
							ws.send(serialized);

							if (isBroadcast) {
								for (const client of clients) {
									if (client !== ws) {
										client.send(serialized);
									}
								}
							}

							if (event.type === "done") {
								session.update(event.sessionId);
							}
						}
					}
				} catch (err) {
					ws.send(serialize({ type: "error", message: extractError(err) }));
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
