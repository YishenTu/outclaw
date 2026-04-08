import { describe, expect, mock, test } from "bun:test";
import {
	buildRuntimeSocketUrl,
	sendRuntimePrompt,
} from "../../src/frontend/runtime-client/index.ts";

describe("runtime client", () => {
	test("adds the client type to the runtime socket URL", () => {
		expect(buildRuntimeSocketUrl("ws://localhost:4000", "telegram")).toBe(
			"ws://localhost:4000/?client=telegram",
		);
	});

	test("serializes prompt images into the websocket message", () => {
		const send = mock((_data: string) => {});
		const ws = { send } as unknown as WebSocket;

		sendRuntimePrompt(ws, "", "telegram", [
			{ path: "/tmp/cat.png", mediaType: "image/png" },
		]);

		expect(send).toHaveBeenCalledTimes(1);
		expect(JSON.parse(send.mock.calls[0]?.[0] as string)).toEqual({
			type: "prompt",
			prompt: "",
			source: "telegram",
			images: [{ path: "/tmp/cat.png", mediaType: "image/png" }],
		});
	});
});
