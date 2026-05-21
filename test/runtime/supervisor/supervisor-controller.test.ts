import { describe, expect, mock, test } from "bun:test";
import type {
	BrowserTerminalSummary,
	ServerEvent,
} from "../../../src/common/protocol.ts";
import type { AgentRuntimeRegistry } from "../../../src/runtime/supervisor/agent-runtime-registry.ts";
import type { ClientAgentBinding } from "../../../src/runtime/supervisor/client-agent-binding.ts";
import { SupervisorController } from "../../../src/runtime/supervisor/supervisor-controller.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";

function createBrowserWs(): WsClient & { events: () => ServerEvent[] } {
	const events: ServerEvent[] = [];
	const ws = {
		data: {
			clientType: "browser" as const,
			cookieClientId: "browser-1",
		},
		send: mock((message: string) => {
			events.push(JSON.parse(message) as ServerEvent);
		}),
		events: () => events,
	};
	return ws as unknown as WsClient & { events: () => ServerEvent[] };
}

function createTerminalManager() {
	return {
		attach: mock(() => false),
		close: mock(() => false),
		create: mock(() => undefined as BrowserTerminalSummary | undefined),
		detachClient: mock(() => {}),
		input: mock(() => false),
		list: mock(() => [] as BrowserTerminalSummary[]),
		resize: mock(() => false),
	};
}

describe("SupervisorController browser terminals", () => {
	test("rejects terminal creation when scope id does not match the resolved target", () => {
		const terminalManager = createTerminalManager();
		const controller = new SupervisorController({
			bindings: {} as ClientAgentBinding,
			registry: {} as AgentRuntimeRegistry,
			resolveTerminalCwd: () =>
				({
					cwd: "/workspace/agent-b",
					scopeId: "agent-b",
				}) as { cwd: string; scopeId: string },
			terminalManager,
		});
		const ws = createBrowserWs();

		controller.handleMessage(
			ws,
			JSON.stringify({
				type: "terminal_create",
				name: "Terminal",
				scopeId: "agent-a",
				target: { kind: "agent", agentId: "agent-b" },
				terminalId: "terminal-1",
			}),
		);

		expect(terminalManager.create).not.toHaveBeenCalled();
		expect(ws.events()).toContainEqual({
			type: "terminal_error",
			message: "Terminal scope does not match target",
			terminalId: "terminal-1",
		});
	});
});
