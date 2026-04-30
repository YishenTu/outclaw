import { describe, expect, test } from "bun:test";
import { requestControlMessage } from "../../src/cli/control-client.ts";
import { createTestServer } from "../helpers/test-server.ts";

describe("requestControlMessage", () => {
	test("sends one control request and resolves only the expected response", async () => {
		const server = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message(ws, rawMessage) {
					expect(JSON.parse(String(rawMessage))).toEqual({
						type: "cron_run",
						jobName: "daily",
					});
					ws.send(JSON.stringify({ type: "runtime_status" }));
					ws.send(
						JSON.stringify({
							type: "cron_run_response",
							accepted: true,
						}),
					);
				},
			},
		});

		try {
			await expect(
				requestControlMessage({
					closeBeforeResponseMessage: "closed early",
					errorFallback: "failed",
					errorType: "cron_run_error",
					port: server.port as number,
					request: {
						type: "cron_run",
						jobName: "daily",
					},
					responseType: "cron_run_response",
					toResult: (message) => message.accepted,
				}),
			).resolves.toBe(true);
		} finally {
			server.stop();
		}
	});

	test("reports timeout and early-close failures with command-specific messages", async () => {
		const timeoutServer = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message() {},
			},
		});

		try {
			await expect(
				requestControlMessage({
					closeBeforeResponseMessage: "closed early",
					errorFallback: "failed",
					errorType: "ask_error",
					port: timeoutServer.port as number,
					request: { type: "ask" },
					responseType: "ask_response",
					timeout: {
						message: "ask timed out",
						ms: 5,
					},
					toResult: () => "",
				}),
			).rejects.toThrow("TIMEOUT:ask timed out");
		} finally {
			timeoutServer.stop();
		}

		const closeServer = createTestServer({
			port: 0,
			fetch(req, websocketServer) {
				if (websocketServer.upgrade(req)) {
					return;
				}
				return new Response("ok");
			},
			websocket: {
				message() {},
				open(ws) {
					ws.close();
				},
			},
		});

		try {
			await expect(
				requestControlMessage({
					closeBeforeResponseMessage: "closed early",
					errorFallback: "failed",
					errorType: "ask_error",
					port: closeServer.port as number,
					request: { type: "ask" },
					responseType: "ask_response",
					toResult: () => "",
				}),
			).rejects.toThrow("closed early");
		} finally {
			closeServer.stop();
		}
	});
});
