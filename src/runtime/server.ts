import { ClaudeAdapter } from "../backend/adapters/claude.ts";
import {
	extractError,
	type Facade,
	parseMessage,
	serialize,
	type UsageInfo,
} from "../common/protocol.ts";
import type { SessionStore } from "./db.ts";
import { readHistory } from "./history.ts";
import { MessageQueue } from "./queue.ts";
import { SessionManager } from "./session.ts";

interface RuntimeOptions {
	port: number;
	facade?: Facade;
	cwd?: string;
	store?: SessionStore;
}

// biome-ignore lint/complexity/noBannedTypes: Bun WS generic requires object type
type WsClient = import("bun").ServerWebSocket<{}>;

export function createRuntime(options: RuntimeOptions) {
	const facade = options.facade ?? new ClaudeAdapter();
	const MODEL_ALIASES: Record<string, string> = {
		opus: "claude-opus-4-6[1m]",
		sonnet: "sonnet",
		haiku: "haiku",
	};
	const VALID_MODELS = Object.keys(MODEL_ALIASES);
	const VALID_EFFORTS = ["low", "medium", "high", "max"];
	const clients = new Set<WsClient>();
	const session = new SessionManager(options.store);
	const queue = new MessageQueue();
	let activeModel = "opus";
	let activeEffort = "high";
	let lastUsage: UsageInfo | undefined;

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
				// Replay active session history on connect
				const sid = session.id;
				if (sid) {
					readHistory(sid)
						.then((messages) => {
							ws.send(serialize({ type: "history_replay", messages }));
						})
						.catch(() => {});
				}
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
					if (data.command === "/status") {
						ws.send(
							serialize({
								type: "runtime_status",
								model: activeModel,
								effort: activeEffort,
								sessionId: session.id,
								usage: lastUsage,
							}),
						);
						return;
					}

					if (data.command === "/new") {
						session.clear();
						ws.send(serialize({ type: "session_cleared" }));
						return;
					}

					const cmd = data.command ?? "";

					// /session commands
					if (cmd === "/session" || cmd.startsWith("/session ")) {
						const arg = cmd.split(" ").slice(1).join(" ").trim();

						if (!arg) {
							// Show current session
							const sid = session.id;
							if (!sid) {
								ws.send(
									serialize({
										type: "error",
										message: "No active session",
									}),
								);
								return;
							}
							const row = options.store?.get(sid);
							ws.send(
								serialize({
									type: "session_info",
									sdkSessionId: sid,
									title: row?.title ?? "Untitled",
									model: row?.model ?? activeModel,
								}),
							);
							return;
						}

						if (arg === "list") {
							const sessions = (options.store?.list() ?? []).map((s) => ({
								sdkSessionId: s.sdkSessionId,
								title: s.title,
								model: s.model,
								lastActive: s.lastActive,
							}));
							ws.send(serialize({ type: "session_list", sessions }));
							return;
						}

						// Switch to session by partial ID match
						const all = options.store?.list() ?? [];
						const match = all.find((s) => s.sdkSessionId.startsWith(arg));
						if (!match) {
							ws.send(
								serialize({
									type: "error",
									message: `No session matching: ${arg}`,
								}),
							);
							return;
						}
						session.clear();
						session.setTitle(match.title);
						session.update(match.sdkSessionId, match.model);
						ws.send(
							serialize({
								type: "session_switched",
								sdkSessionId: match.sdkSessionId,
								title: match.title,
							}),
						);
						// Replay history async
						readHistory(match.sdkSessionId)
							.then((messages) => {
								ws.send(serialize({ type: "history_replay", messages }));
							})
							.catch(() => {
								// History unavailable — not fatal
							});
						return;
					}

					// /model opus OR /opus — both switch model
					// /model with no arg — show current
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
					// Auto-title from first prompt in a new session
					if (!session.id) {
						session.setTitle(prompt.slice(0, 100));
					}
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
								model: MODEL_ALIASES[activeModel] ?? activeModel,
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
									session.update(event.sessionId, activeModel);
									lastUsage = event.usage;
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
