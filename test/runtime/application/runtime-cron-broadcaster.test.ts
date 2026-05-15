import { describe, expect, test } from "bun:test";
import type { Facade, ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeClientGateway } from "../../../src/runtime/application/gateway/runtime-client-gateway.ts";
import { RuntimeCronBroadcaster } from "../../../src/runtime/application/runtime-cron-broadcaster.ts";
import type { SessionService } from "../../../src/runtime/application/session-service.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";

function mockWs(
	clientType: "telegram" | "tui" | "browser" = "tui",
): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	return {
		data: { clientType },
		send(payload: string) {
			sent.push(payload);
		},
		events() {
			return sent.map((item) => JSON.parse(item) as ServerEvent);
		},
	} as WsClient & { events: () => ServerEvent[] };
}

function createGateway() {
	return new RuntimeClientGateway({
		facade: {
			providerId: "mock",
			async *run() {},
		} as Facade,
		getStatusEvent: () => ({
			type: "runtime_status",
			model: "opus",
			effort: "medium",
			running: false,
		}),
	});
}

function createSessionsRecorder() {
	const recorded: Array<{
		jobName: string;
		model: string;
		providerId?: string;
		resultText?: string;
		failure?: {
			failedAt: number;
			message: string;
		};
		sessionId: string;
		ranAt: number;
	}> = [];
	return {
		recorded,
		sessions: {
			providerId: "mock",
			recordCronRun(params: {
				jobName: string;
				model: string;
				providerId?: string;
				resultText?: string;
				failure?: {
					failedAt: number;
					message: string;
				};
				sessionId: string;
				ranAt: number;
			}) {
				recorded.push(params);
			},
		} as unknown as SessionService,
	};
}

describe("RuntimeCronBroadcaster", () => {
	test("records cron sessions, broadcasts visible results, and delivers to Telegram when configured", async () => {
		const clients = createGateway();
		const tui = mockWs("tui");
		const browser = mockWs("browser");
		clients.handleOpen(tui);
		clients.handleOpen(browser);
		const delivered: Array<{
			jobName: string;
			telegramChatId: number;
			text: string;
		}> = [];
		const { recorded, sessions } = createSessionsRecorder();
		const broadcaster = new RuntimeCronBroadcaster({
			agentId: "agent-railly",
			clients,
			deliverCronResult: (params) => {
				delivered.push(params);
			},
			sessions,
		});

		await broadcaster.broadcastResult({
			jobName: "daily",
			model: "haiku",
			sessionId: "cron-session-123",
			telegramChatId: 456,
			text: "summary",
		});

		expect(recorded).toEqual([
			{
				jobName: "daily",
				model: "haiku",
				providerId: "mock",
				sessionId: "cron-session-123",
				ranAt: expect.any(Number),
			},
		]);
		expect(browser.events()).toContainEqual(
			expect.objectContaining({
				type: "cron_result",
				jobName: "daily",
				providerId: "mock",
				text: "summary",
				sessionId: "cron-session-123",
				ranAt: expect.any(Number),
			}),
		);
		expect(browser.events()).toContainEqual({
			type: "browser_sidebar_invalidated",
			agentId: "agent-railly",
			sections: ["cron"],
		});
		expect(tui.events()).toContainEqual(
			expect.objectContaining({
				type: "cron_result",
				jobName: "daily",
				providerId: "mock",
				text: "summary",
				sessionId: "cron-session-123",
				ranAt: expect.any(Number),
			}),
		);
		expect(delivered).toEqual([
			{
				jobName: "daily",
				telegramChatId: 456,
				text: "summary",
			},
		]);
	});

	test("suppressed completions persist sessions and update browser history without delivering to chat surfaces", async () => {
		const clients = createGateway();
		const tui = mockWs("tui");
		const browser = mockWs("browser");
		clients.handleOpen(tui);
		clients.handleOpen(browser);
		const delivered: unknown[] = [];
		const { recorded, sessions } = createSessionsRecorder();
		const broadcaster = new RuntimeCronBroadcaster({
			agentId: "agent-railly",
			clients,
			deliverCronResult: (params) => {
				delivered.push(params);
			},
			sessions,
		});

		await broadcaster.broadcastResult({
			jobName: "daily",
			model: "haiku",
			sessionId: "cron-session-123",
			suppressDelivery: true,
			telegramChatId: 456,
			text: "NO_REPLY",
		});

		expect(recorded).toEqual([
			{
				jobName: "daily",
				model: "haiku",
				providerId: "mock",
				sessionId: "cron-session-123",
				ranAt: expect.any(Number),
			},
		]);
		expect(browser.events()).toContainEqual({
			type: "browser_sidebar_invalidated",
			agentId: "agent-railly",
			sections: ["cron"],
		});
		expect(
			browser.events().filter((event) => event.type === "cron_result"),
		).toEqual([]);
		expect(
			tui.events().filter((event) => event.type === "cron_result"),
		).toEqual([]);
		expect(delivered).toEqual([]);
	});

	test("failed completions persist fallback text for cron history", async () => {
		const clients = createGateway();
		const browser = mockWs("browser");
		clients.handleOpen(browser);
		const { recorded, sessions } = createSessionsRecorder();
		const broadcaster = new RuntimeCronBroadcaster({
			agentId: "agent-railly",
			clients,
			sessions,
		});

		await broadcaster.broadcastResult({
			failureMessage: "agent exploded",
			jobName: "daily",
			model: "haiku",
			persistResultText: true,
			sessionId: "cron-session-error",
			text: "[error] agent exploded",
		});

		expect(recorded).toEqual([
			{
				jobName: "daily",
				model: "haiku",
				providerId: "mock",
				sessionId: "cron-session-error",
				ranAt: expect.any(Number),
				resultText: "[error] agent exploded",
				failure: {
					failedAt: expect.any(Number),
					message: "agent exploded",
				},
			},
		]);
		expect(browser.events()).toContainEqual(
			expect.objectContaining({
				type: "cron_result",
				jobName: "daily",
				sessionId: "cron-session-error",
				text: "[error] agent exploded",
			}),
		);
		expect(browser.events()).toContainEqual({
			type: "browser_sidebar_invalidated",
			agentId: "agent-railly",
			sections: ["cron"],
		});
	});

	test("uses the cron result provider when persisting and broadcasting", async () => {
		const clients = createGateway();
		const browser = mockWs("browser");
		clients.handleOpen(browser);
		const { recorded, sessions } = createSessionsRecorder();
		const broadcaster = new RuntimeCronBroadcaster({
			clients,
			sessions,
		});

		await broadcaster.broadcastResult({
			jobName: "daily",
			model: "gpt-5.5",
			providerId: "codex",
			sessionId: "codex-cron-session",
			text: "summary",
		});

		expect(recorded).toEqual([
			{
				jobName: "daily",
				model: "gpt-5.5",
				providerId: "codex",
				sessionId: "codex-cron-session",
				ranAt: expect.any(Number),
			},
		]);
		expect(browser.events()).toContainEqual(
			expect.objectContaining({
				type: "cron_result",
				providerId: "codex",
				sessionId: "codex-cron-session",
			}),
		);
	});

	test("Telegram delivery failures are logged without failing the broadcast", async () => {
		const originalConsoleError = console.error;
		const logged: string[] = [];
		console.error = (message?: unknown) => {
			logged.push(String(message));
		};

		try {
			const clients = createGateway();
			const { sessions } = createSessionsRecorder();
			const broadcaster = new RuntimeCronBroadcaster({
				clients,
				deliverCronResult: () => {
					throw new Error("telegram failed");
				},
				sessions,
			});

			await expect(
				broadcaster.broadcastResult({
					jobName: "daily",
					model: "haiku",
					telegramChatId: 456,
					text: "summary",
				}),
			).resolves.toBeUndefined();

			expect(logged).toEqual([
				"Failed to deliver cron result to Telegram: telegram failed",
			]);
		} finally {
			console.error = originalConsoleError;
		}
	});
});
