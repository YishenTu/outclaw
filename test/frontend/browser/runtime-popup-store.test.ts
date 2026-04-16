import { beforeEach, describe, expect, test } from "bun:test";
import { useRuntimePopupStore } from "../../../src/frontend/browser/stores/runtime-popup.ts";

describe("runtime popup store", () => {
	beforeEach(() => {
		useRuntimePopupStore.setState({ popup: null });
	});

	test("opens and closes the agent menu popup", () => {
		useRuntimePopupStore.getState().openAgentMenu({
			type: "agent_menu",
			activeAgentId: "agent-a",
			activeAgentName: "alpha",
			agents: [
				{ agentId: "agent-a", name: "alpha" },
				{ agentId: "agent-b", name: "beta" },
			],
		});

		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "agent",
			activeAgentId: "agent-a",
			activeAgentName: "alpha",
			agents: [
				{ agentId: "agent-a", name: "alpha" },
				{ agentId: "agent-b", name: "beta" },
			],
		});

		useRuntimePopupStore.getState().closePopup();
		expect(useRuntimePopupStore.getState().popup).toBeNull();
	});

	test("opens the session popup and status popup", () => {
		useRuntimePopupStore.getState().openSessionMenu({
			type: "session_menu",
			activeSessionId: "sdk-alpha",
			sessions: [
				{
					sdkSessionId: "sdk-alpha",
					title: "Alpha",
					model: "opus",
					lastActive: 100,
				},
			],
		});

		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "session",
			activeSessionId: "sdk-alpha",
			sessions: [
				{
					sdkSessionId: "sdk-alpha",
					title: "Alpha",
					model: "opus",
					lastActive: 100,
				},
			],
		});

		useRuntimePopupStore.getState().openStatus("Status\nsession: Alpha");
		expect(useRuntimePopupStore.getState().popup).toEqual({
			kind: "status",
			text: "Status\nsession: Alpha",
		});
	});
});
