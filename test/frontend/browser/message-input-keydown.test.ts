import { describe, expect, test } from "bun:test";
import { handleMessageInputKeydown } from "../../../src/frontend/browser/components/chat/message-input-keydown.ts";

describe("browser message input keydown", () => {
	test("submits on Enter when composition is inactive", () => {
		let submitted = false;
		let prevented = false;

		const handled = handleMessageInputKeydown(
			{
				key: "Enter",
				preventDefault: () => {
					prevented = true;
				},
			},
			{
				showSlashMenu: false,
				filteredCommandCount: 0,
				selectedIndex: 0,
				interruptible: false,
				isComposing: false,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => false,
				submitValue: () => {
					submitted = true;
				},
			},
		);

		expect(handled).toBe(true);
		expect(submitted).toBe(true);
		expect(prevented).toBe(true);
	});

	test("does not submit on Enter while composition is active", () => {
		let submitted = false;
		let prevented = false;

		const handled = handleMessageInputKeydown(
			{
				key: "Enter",
				nativeEvent: { isComposing: true },
				preventDefault: () => {
					prevented = true;
				},
			},
			{
				showSlashMenu: false,
				filteredCommandCount: 0,
				selectedIndex: 0,
				interruptible: false,
				isComposing: false,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => false,
				submitValue: () => {
					submitted = true;
				},
			},
		);

		expect(handled).toBe(false);
		expect(submitted).toBe(false);
		expect(prevented).toBe(false);
	});

	test("does not select a slash command on Enter while composition is active", () => {
		let selectedIndex = -1;
		let prevented = false;

		const handled = handleMessageInputKeydown(
			{
				key: "Enter",
				preventDefault: () => {
					prevented = true;
				},
			},
			{
				showSlashMenu: true,
				filteredCommandCount: 3,
				selectedIndex: 1,
				interruptible: false,
				isComposing: true,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: (index) => {
					selectedIndex = index;
				},
				sendStopCommand: () => false,
				submitValue: () => {},
			},
		);

		expect(handled).toBe(false);
		expect(selectedIndex).toBe(-1);
		expect(prevented).toBe(false);
	});

	test("does not submit on the IME fallback keycode after composition events desync", () => {
		let submitted = false;
		let prevented = false;

		const handled = handleMessageInputKeydown(
			{
				key: "Enter",
				keyCode: 229,
				preventDefault: () => {
					prevented = true;
				},
			},
			{
				showSlashMenu: false,
				filteredCommandCount: 0,
				selectedIndex: 0,
				interruptible: false,
				isComposing: false,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => false,
				submitValue: () => {
					submitted = true;
				},
			},
		);

		expect(handled).toBe(false);
		expect(submitted).toBe(false);
		expect(prevented).toBe(false);
	});
});
