import { describe, expect, test } from "bun:test";
import type {
	ClientMessage,
	ReplyContext,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import type { PromptExecution } from "../../../src/runtime/application/prompt-dispatcher.ts";
import { RuntimeMessageRouter } from "../../../src/runtime/application/runtime-message-router.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";

function createWs(
	data?: Partial<WsClient["data"]>,
): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	return {
		data,
		send(payload: string) {
			sent.push(payload);
		},
		events() {
			return sent.map((item) => JSON.parse(item) as ServerEvent);
		},
	} as WsClient & { events: () => ServerEvent[] };
}

function createRouter(overrides?: {
	isShuttingDown?: boolean;
	wsData?: Partial<WsClient["data"]>;
}) {
	const ws = createWs(overrides?.wsData);
	const enqueued: PromptExecution[] = [];
	const requestedSkills: WsClient[] = [];
	const commands: Array<{ command: string; ws: WsClient }> = [];
	const router = new RuntimeMessageRouter({
		clients: {
			requestSkills(target) {
				requestedSkills.push(target);
			},
			send(target, event) {
				target.send(JSON.stringify(event));
			},
		},
		controlPlane: {
			handleCommand(target, command) {
				commands.push({ command, ws: target });
			},
		},
		execution: {
			enqueuePrompt(task) {
				enqueued.push(task);
			},
			get isShuttingDown() {
				return overrides?.isShuttingDown ?? false;
			},
		},
	});

	function handle(message: ClientMessage | string) {
		router.handleMessage(
			ws,
			typeof message === "string" ? message : JSON.stringify(message),
		);
	}

	return { commands, enqueued, handle, requestedSkills, ws };
}

describe("RuntimeMessageRouter", () => {
	test("sends an error for invalid JSON", () => {
		const { handle, ws } = createRouter();
		handle("{");

		const errorEvent = ws.events().find((event) => event.type === "error");
		expect(errorEvent).toBeDefined();
		expect(errorEvent).toMatchObject({
			type: "error",
		});
		expect((errorEvent as { message: string }).message).toContain("JSON");
	});

	test("rejects messages while the runtime is shutting down", () => {
		const { handle, ws } = createRouter({ isShuttingDown: true });
		handle({ type: "request_skills" });

		expect(ws.events()).toEqual([
			{
				type: "status",
				message: "Runtime shutting down",
			},
		]);
	});

	test("routes skill requests through the client gateway", () => {
		const { handle, requestedSkills, ws } = createRouter();
		handle({ type: "request_skills" });

		expect(requestedSkills).toEqual([ws]);
	});

	test("routes command messages to the control plane", () => {
		const { commands, handle, ws } = createRouter();
		handle({ type: "command", command: "/status" });

		expect(commands).toEqual([{ command: "/status", ws }]);
	});

	test("enqueues prompt messages with normalized runtime metadata", () => {
		const { enqueued, handle, ws } = createRouter({
			wsData: {
				telegramBotId: "bot-a",
				telegramUserId: 42,
			},
		});
		const replyContext: ReplyContext = { text: "Earlier message" };
		handle({
			type: "prompt",
			prompt: "Inspect this",
			images: [{ mediaType: "image/png", path: "/tmp/sample.png" }],
			replyContext,
			source: "telegram",
			telegramChatId: 42,
		});

		expect(enqueued).toEqual([
			{
				sender: ws,
				prompt: "Inspect this",
				images: [{ mediaType: "image/png", path: "/tmp/sample.png" }],
				replyContext,
				source: "telegram",
				telegramChatId: 42,
				telegramBotId: "bot-a",
			},
		]);
	});

	test("ignores empty prompt messages without images", () => {
		const { enqueued, handle } = createRouter();
		handle({ type: "prompt", prompt: "" });

		expect(enqueued).toEqual([]);
	});
});
