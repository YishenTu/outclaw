import { describe, expect, test } from "bun:test";
import type { Facade, ServerEvent } from "../../../src/common/protocol.ts";
import { RuntimeClientGateway } from "../../../src/runtime/application/runtime-client-gateway.ts";
import { RuntimeCronBroadcaster } from "../../../src/runtime/application/runtime-cron-broadcaster.ts";
import type { SessionService } from "../../../src/runtime/application/session-service.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";

function mockWs(): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	return {
		data: { clientType: "tui" },
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
	const recorded: Array<{ jobName: string; model: string; sessionId: string }> =
		[];
	return {
		recorded,
		sessions: {
			recordCronRun(params: {
				jobName: string;
				model: string;
				sessionId: string;
			}) {
				recorded.push(params);
			},
		} as unknown as SessionService,
	};
}

describe("RuntimeCronBroadcaster", () => {
	test("records cron sessions, broadcasts visible results, and delivers to Telegram when configured", async () => {
		const clients = createGateway();
		const ws = mockWs();
		clients.handleOpen(ws);
		const delivered: Array<{
			jobName: string;
			telegramChatId: number;
			text: string;
		}> = [];
		const { recorded, sessions } = createSessionsRecorder();
		const broadcaster = new RuntimeCronBroadcaster({
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
				sessionId: "cron-session-123",
			},
		]);
		expect(ws.events()).toContainEqual({
			type: "cron_result",
			jobName: "daily",
			text: "summary",
		});
		expect(delivered).toEqual([
			{
				jobName: "daily",
				telegramChatId: 456,
				text: "summary",
			},
		]);
	});

	test("suppressed completions persist sessions without broadcasting or delivering", async () => {
		const clients = createGateway();
		const ws = mockWs();
		clients.handleOpen(ws);
		const delivered: unknown[] = [];
		const { recorded, sessions } = createSessionsRecorder();
		const broadcaster = new RuntimeCronBroadcaster({
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
			text: "",
		});

		expect(recorded).toEqual([
			{
				jobName: "daily",
				model: "haiku",
				sessionId: "cron-session-123",
			},
		]);
		expect(ws.events().filter((event) => event.type === "cron_result")).toEqual(
			[],
		);
		expect(delivered).toEqual([]);
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
