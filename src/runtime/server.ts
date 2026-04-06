import { ClaudeAdapter } from "../backend/adapters/claude.ts";
import {
	extractError,
	type Facade,
	parseMessage,
	serialize,
} from "../common/protocol.ts";
import { MessageQueue } from "./queue.ts";
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
	const VALID_MODELS = ["opus", "sonnet", "haiku"];
	const VALID_EFFORTS = ["low", "medium", "high", "max"];
	const clients = new Set<WsClient>();
	const session = new SessionManager();
	const queue = new MessageQueue();
	let activeModel = "sonnet";
	let activeEffort = "high";

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
			message(ws, message) {
				const data = parseMessage(message as string) as {
					type: string;
					command?: string;
					prompt?: string;
					source?: string;
				};

				if (data.type === "command") {
					if (data.command === "/new") {
						session.clear();
						ws.send(serialize({ type: "session_cleared" }));
						return;
					}

					// /model opus OR /opus — both switch model
					// /model with no arg — show current
					const cmd = data.command ?? "";
					const modelArg = cmd.startsWith("/model")
						? cmd.split(" ")[1]?.trim()
						: VALID_MODELS.find((m) => cmd === `/${m}`);

					if (cmd === "/model" || cmd.startsWith("/model ") || modelArg) {
						if (!modelArg) {
							ws.send(
								serialize({
									type: "model_changed",
									model: activeModel,
								}),
							);
							return;
						}
						if (!VALID_MODELS.includes(modelArg)) {
							ws.send(
								serialize({
									type: "error",
									message: `Invalid model: ${modelArg}. Valid: ${VALID_MODELS.join(", ")}`,
								}),
							);
							return;
						}
						activeModel = modelArg;
						ws.send(serialize({ type: "model_changed", model: modelArg }));
						return;
					}

					// /thinking <level> — switch effort
					if (cmd.startsWith("/thinking")) {
						const effortArg = cmd.split(" ")[1]?.trim();
						if (!effortArg) {
							ws.send(
								serialize({
									type: "effort_changed",
									effort: activeEffort,
								}),
							);
							return;
						}
						if (!VALID_EFFORTS.includes(effortArg)) {
							ws.send(
								serialize({
									type: "error",
									message: `Invalid effort: ${effortArg}. Valid: ${VALID_EFFORTS.join(", ")}`,
								}),
							);
							return;
						}
						activeEffort = effortArg;
						ws.send(
							serialize({
								type: "effort_changed",
								effort: effortArg,
							}),
						);
						return;
					}

					return;
				}

				if (data.type === "prompt" && data.prompt) {
					const { prompt, source } = data;
					queue.enqueue(async () => {
						try {
							const isBroadcast = source === "telegram";

							if (isBroadcast) {
								const userPrompt = serialize({
									type: "user_prompt",
									prompt,
									source: source ?? "unknown",
								});
								for (const client of clients) {
									if (client !== ws) {
										client.send(userPrompt);
									}
								}
							}

							for await (const event of facade.run({
								prompt,
								resume: session.id,
								cwd: options.cwd,
								model: activeModel,
								effort: activeEffort,
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
						} catch (err) {
							ws.send(
								serialize({
									type: "error",
									message: extractError(err),
								}),
							);
						}
					});
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
