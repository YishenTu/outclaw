import { describe, expect, test } from "bun:test";
import type { ImageRef } from "../../../src/common/protocol.ts";
import { dispatchBrowserPrompt } from "../../../src/frontend/browser/send-browser-prompt.ts";

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
			startAssistantTurn: (sessionKey) => {
				calls.push(`start:${sessionKey}`);
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
			"start:agent-a:claude:sdk-alpha",
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
});
