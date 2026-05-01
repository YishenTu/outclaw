import { describe, expect, test } from "bun:test";
import { clearSubmittedDraftIfUnchanged } from "../../../src/frontend/browser/components/chat/composer/message-input-draft.ts";

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

describe("message input draft", () => {
	test("clears a draft only when it still matches the submitted snapshot", () => {
		const submitted = {
			text: "describe this",
			images: [createAttachment("img-1")],
		};

		expect(
			clearSubmittedDraftIfUnchanged(
				{
					text: "describe this",
					images: [createAttachment("img-1")],
				},
				submitted,
			),
		).toEqual({
			text: "",
			images: [],
		});
	});

	test("preserves newer edits when the draft changed during submission", () => {
		const submitted = {
			text: "describe this",
			images: [createAttachment("img-1")],
		};
		const current = {
			text: "next message",
			images: [createAttachment("img-1"), createAttachment("img-2")],
		};

		expect(clearSubmittedDraftIfUnchanged(current, submitted)).toEqual(current);
	});
});
