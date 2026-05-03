import { describe, expect, test } from "bun:test";
import type { ImageRef } from "../../../src/common/protocol.ts";
import { dispatchBrowserPrompt } from "../../../src/frontend/browser/prompts/send-browser-prompt.ts";
import { dispatchBrowserTextPrompt } from "../../../src/frontend/browser/prompts/send-browser-text-prompt.ts";

function createAttachment(id: string) {
	return {
		id,
		file: new File(["abc"], `${id}.png`, { type: "image/png" }),
		image: {
			kind: "inline" as const,
			base64: "YWJj",
			mediaType: "image/png" as const,
		},
	};
}

describe("dispatchBrowserPrompt", () => {
	test("sends image prompts using the session captured before upload", async () => {
		const socket = { id: "socket-1" };
		const calls: string[] = [];

		const sent = await dispatchBrowserPrompt({
			input: "describe this",
			images: [createAttachment("img-1")],
			getActiveAgentId: () => "agent-a",
			getCurrentSessionKey: () => "agent-a:claude:sdk-alpha",
			getSocket: () => socket,
			isSocketOpen: (candidate): candidate is typeof socket =>
				candidate === socket,
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			uploadImages: async (files) => {
				calls.push(`upload:${files.length}`);
				return [{ path: "/tmp/cat.png", mediaType: "image/png" }];
			},
			sendPrompt: (target, prompt, uploadedImages) => {
				calls.push(
					`prompt:${target === socket}:${prompt}:${uploadedImages?.length ?? 0}`,
				);
			},
			pushMessage: (sessionKey, message) => {
				calls.push(
					`push:${sessionKey}:${message.content}:${message.images?.length ?? 0}`,
				);
			},
			queueMessage: () => {
				calls.push("queue");
			},
			startAssistantTurn: (sessionKey, options) => {
				calls.push(
					`start:${sessionKey}:${String(options?.pendingPromptStart ?? false)}`,
				);
			},
			setSessionError: (sessionKey, error) => {
				calls.push(`session-error:${sessionKey}:${error}`);
			},
			setRuntimeError: (error) => {
				calls.push(`runtime-error:${error}`);
			},
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"upload:1",
			"prompt:true:describe this:1",
			"push:agent-a:claude:sdk-alpha:describe this:1",
			"start:agent-a:claude:sdk-alpha:true",
			"session-error:agent-a:claude:sdk-alpha:null",
			"runtime-error:null",
		]);
	});

	test("aborts instead of sending into a different session after upload", async () => {
		const socket = { id: "socket-1" };
		let currentSessionKey = "agent-a:claude:sdk-alpha";
		let resolveUpload: ((images: ImageRef[]) => void) | undefined;
		const upload = new Promise<ImageRef[]>((resolve) => {
			resolveUpload = resolve;
		});
		const calls: string[] = [];

		const pending = dispatchBrowserPrompt({
			input: "describe this",
			images: [createAttachment("img-1")],
			getActiveAgentId: () => "agent-a",
			getCurrentSessionKey: () => currentSessionKey,
			getSocket: () => socket,
			isSocketOpen: (candidate): candidate is typeof socket =>
				candidate === socket,
			sendCommand: () => true,
			uploadImages: async () => {
				calls.push("upload:start");
				return await upload;
			},
			sendPrompt: () => {
				calls.push("prompt:sent");
			},
			pushMessage: () => {
				calls.push("push:sent");
			},
			queueMessage: () => {
				calls.push("queue:sent");
			},
			startAssistantTurn: () => {
				calls.push("start:sent");
			},
			setSessionError: () => {
				calls.push("session-error:set");
			},
			setRuntimeError: (error) => {
				calls.push(`runtime-error:${error}`);
			},
		});

		currentSessionKey = "agent-a:claude:sdk-beta";
		resolveUpload?.([{ path: "/tmp/cat.png", mediaType: "image/png" }]);

		expect(await pending).toBe(false);
		expect(calls).toEqual([
			"upload:start",
			"runtime-error:Conversation changed while images were uploading. Please resend.",
		]);
	});

	test("queues image-capable prompts without starting a new assistant turn", async () => {
		const socket = { id: "socket-1" };
		const calls: string[] = [];

		const sent = await dispatchBrowserPrompt({
			input: "queued follow-up",
			images: [],
			getActiveAgentId: () => "agent-a",
			getCurrentSessionKey: () => "agent-a:claude:sdk-alpha",
			getSocket: () => socket,
			isSocketOpen: (candidate): candidate is typeof socket =>
				candidate === socket,
			sendCommand: () => true,
			uploadImages: async () => [],
			sendPrompt: (target, prompt) => {
				calls.push(`prompt:${target === socket}:${prompt}`);
			},
			pushMessage: () => {
				calls.push("push");
			},
			queueMessage: (sessionKey, message) => {
				calls.push(`queue:${sessionKey}:${message.content}`);
			},
			shouldQueuePrompt: () => true,
			startAssistantTurn: () => {
				calls.push("start");
			},
			setSessionError: (sessionKey, error) => {
				calls.push(`session-error:${sessionKey}:${error}`);
			},
			setRuntimeError: (error) => {
				calls.push(`runtime-error:${error}`);
			},
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"prompt:true:queued follow-up",
			"queue:agent-a:claude:sdk-alpha:queued follow-up",
			"session-error:agent-a:claude:sdk-alpha:null",
			"runtime-error:null",
		]);
	});
});

describe("dispatchBrowserTextPrompt", () => {
	test("sends prompt text through the active socket and pins the live session", () => {
		const socket = { id: "socket-1" };
		const calls: string[] = [];

		const sent = dispatchBrowserTextPrompt({
			input: "  /compact  ",
			getActiveAgentId: () => "agent-a",
			getCurrentSessionKey: () => "agent-a:claude:sdk-alpha",
			getSocket: () => socket,
			isSocketOpen: (candidate): candidate is typeof socket =>
				candidate === socket,
			pinSession: (sessionKey) => calls.push(`pin:${sessionKey}`),
			pushUserMessage: (sessionKey, message) => {
				calls.push(`push:${sessionKey}:${message.content}`);
			},
			queueUserMessage: () => {
				calls.push("queue");
			},
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendPrompt: (target, prompt) => {
				calls.push(`prompt:${target === socket}:${prompt}`);
			},
			setRuntimeError: (error) => calls.push(`runtime:${error}`),
			setSessionError: (sessionKey, error) => {
				calls.push(`session:${sessionKey}:${error}`);
			},
			startAssistantTurn: (sessionKey, options) =>
				calls.push(
					`start:${sessionKey}:${String(options?.pendingPromptStart ?? false)}`,
				),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"prompt:true:/compact",
			"pin:agent-a:claude:sdk-alpha",
			"push:agent-a:claude:sdk-alpha:/compact",
			"start:agent-a:claude:sdk-alpha:true",
			"session:agent-a:claude:sdk-alpha:null",
			"runtime:null",
		]);
	});

	test("routes runtime commands without creating a chat turn", () => {
		const calls: string[] = [];
		const socket = { id: "socket-1" };

		const sent = dispatchBrowserTextPrompt({
			input: " /status ",
			getActiveAgentId: () => "agent-a",
			getCurrentSessionKey: () => "agent-a:claude:sdk-alpha",
			getSocket: () => socket,
			isSocketOpen: (candidate): candidate is typeof socket =>
				candidate === socket,
			pinSession: (sessionKey) => calls.push(`pin:${sessionKey}`),
			pushUserMessage: () => calls.push("push"),
			queueUserMessage: () => calls.push("queue"),
			sendCommand: (command) => {
				calls.push(`command:${command}`);
				return true;
			},
			sendPrompt: () => calls.push("prompt"),
			setRuntimeError: (error) => calls.push(`runtime:${error}`),
			setSessionError: (sessionKey, error) => {
				calls.push(`session:${sessionKey}:${error}`);
			},
			startAssistantTurn: (sessionKey) => calls.push(`start:${sessionKey}`),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual(["command:/status"]);
	});

	test("surfaces disconnected errors before mutating chat state", () => {
		const calls: string[] = [];
		type TestSocket = { id: string };

		const sent = dispatchBrowserTextPrompt<TestSocket>({
			input: "hello",
			getActiveAgentId: () => "agent-a",
			getCurrentSessionKey: () => "agent-a:claude:sdk-alpha",
			getSocket: () => null,
			isSocketOpen: (candidate): candidate is TestSocket => candidate !== null,
			pinSession: (sessionKey) => calls.push(`pin:${sessionKey}`),
			pushUserMessage: () => calls.push("push"),
			queueUserMessage: () => calls.push("queue"),
			sendCommand: () => true,
			sendPrompt: () => calls.push("prompt"),
			setRuntimeError: (error) => calls.push(`runtime:${error}`),
			setSessionError: (sessionKey, error) => {
				calls.push(`session:${sessionKey}:${error}`);
			},
			startAssistantTurn: (sessionKey) => calls.push(`start:${sessionKey}`),
		});

		expect(sent).toBe(false);
		expect(calls).toEqual(["runtime:Runtime disconnected"]);
	});

	test("queues text prompts without starting a new assistant turn", () => {
		const socket = { id: "socket-1" };
		const calls: string[] = [];

		const sent = dispatchBrowserTextPrompt({
			input: "queued follow-up",
			getActiveAgentId: () => "agent-a",
			getCurrentSessionKey: () => "agent-a:claude:sdk-alpha",
			getSocket: () => socket,
			isSocketOpen: (candidate): candidate is typeof socket =>
				candidate === socket,
			pinSession: (sessionKey) => calls.push(`pin:${sessionKey}`),
			pushUserMessage: () => {
				calls.push("push");
			},
			queueUserMessage: (sessionKey, message) => {
				calls.push(`queue:${sessionKey}:${message.content}`);
			},
			shouldQueuePrompt: () => true,
			sendCommand: () => true,
			sendPrompt: (target, prompt) => {
				calls.push(`prompt:${target === socket}:${prompt}`);
			},
			setRuntimeError: (error) => calls.push(`runtime:${error}`),
			setSessionError: (sessionKey, error) => {
				calls.push(`session:${sessionKey}:${error}`);
			},
			startAssistantTurn: () => calls.push("start"),
		});

		expect(sent).toBe(true);
		expect(calls).toEqual([
			"prompt:true:queued follow-up",
			"pin:agent-a:claude:sdk-alpha",
			"queue:agent-a:claude:sdk-alpha:queued follow-up",
			"session:agent-a:claude:sdk-alpha:null",
			"runtime:null",
		]);
	});
});
