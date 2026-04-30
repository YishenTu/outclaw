import { describe, expect, mock, test } from "bun:test";
import {
	applyOptimisticPromptState,
	requestTuiSkillsOnce,
	sendWithOpenTuiSocket,
} from "../../../src/frontend/tui/runtime-session-senders.ts";
import { initialTuiState } from "../../../src/frontend/tui/transcript/state.ts";

function createOpenSocket() {
	return {
		readyState: WebSocket.OPEN,
		send: mock((_data: string) => undefined),
	} as unknown as WebSocket;
}

describe("TUI runtime session senders", () => {
	test("reports a local error when sending without an open socket", () => {
		const pushLocalMessage = mock((_role: string, _text: string) => undefined);

		expect(
			sendWithOpenTuiSocket({
				pushLocalMessage,
				send: () => undefined,
				ws: null,
			}),
		).toBe(false);
		expect(pushLocalMessage).toHaveBeenCalledWith(
			"error",
			"Runtime disconnected. Waiting to reconnect.",
		);
	});

	test("sends through an open socket and reports send failures", () => {
		const pushLocalMessage = mock((_role: string, _text: string) => undefined);
		const ws = createOpenSocket();

		expect(
			sendWithOpenTuiSocket({
				pushLocalMessage,
				send: (socket) => socket.send("ok"),
				ws,
			}),
		).toBe(true);
		expect(ws.send).toHaveBeenCalledWith("ok");

		expect(
			sendWithOpenTuiSocket({
				pushLocalMessage,
				send: () => {
					throw new Error("send failed");
				},
				ws,
			}),
		).toBe(false);
		expect(pushLocalMessage).toHaveBeenCalledWith("error", "send failed");
	});

	test("applies optimistic prompt state and compacting slash commands", () => {
		const normal = applyOptimisticPromptState(initialTuiState(), "hello");
		expect(normal.running).toBe(true);
		expect(normal.compacting).toBe(false);
		expect(normal.messages.at(-1)?.text).toBe("hello");

		const compact = applyOptimisticPromptState(initialTuiState(), " /compact ");
		expect(compact.running).toBe(true);
		expect(compact.compacting).toBe(true);
		expect(compact.messages.at(-1)?.text).toBe(" /compact ");
	});

	test("requests skills only when the socket is open and not already requested", () => {
		const ws = createOpenSocket();
		expect(requestTuiSkillsOnce({ alreadyRequested: false, ws })).toBe(true);
		expect(ws.send).toHaveBeenCalledWith('{"type":"request_skills"}');
		expect(requestTuiSkillsOnce({ alreadyRequested: true, ws })).toBe(false);
		expect(requestTuiSkillsOnce({ alreadyRequested: false, ws: null })).toBe(
			false,
		);
	});
});
