import { describe, expect, test } from "bun:test";
import { handleMessageInputKeydown } from "../../../src/frontend/browser/components/chat/composer/message-input-keydown.ts";

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
				showMentionMenu: false,
				mentionItemCount: 0,
				mentionSelectedIndex: 0,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => false,
				submitValue: () => {
					submitted = true;
				},
				setMentionSelectedIndex: () => {},
				applySelectedMention: () => {},
				dismissMentionMenu: () => {},
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
				showMentionMenu: false,
				mentionItemCount: 0,
				mentionSelectedIndex: 0,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => false,
				submitValue: () => {
					submitted = true;
				},
				setMentionSelectedIndex: () => {},
				applySelectedMention: () => {},
				dismissMentionMenu: () => {},
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
				showMentionMenu: false,
				mentionItemCount: 0,
				mentionSelectedIndex: 0,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: (index) => {
					selectedIndex = index;
				},
				sendStopCommand: () => false,
				submitValue: () => {},
				setMentionSelectedIndex: () => {},
				applySelectedMention: () => {},
				dismissMentionMenu: () => {},
			},
		);

		expect(handled).toBe(false);
		expect(selectedIndex).toBe(-1);
		expect(prevented).toBe(false);
	});

	test("Tab applies the selected mention and prevents default", () => {
		let appliedIndex = -1;
		let prevented = false;

		const handled = handleMessageInputKeydown(
			{
				key: "Tab",
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
				showMentionMenu: true,
				mentionItemCount: 4,
				mentionSelectedIndex: 2,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => false,
				submitValue: () => {},
				setMentionSelectedIndex: () => {},
				applySelectedMention: (index) => {
					appliedIndex = index;
				},
				dismissMentionMenu: () => {},
			},
		);

		expect(handled).toBe(true);
		expect(appliedIndex).toBe(2);
		expect(prevented).toBe(true);
	});

	test("Escape dismisses the mention menu", () => {
		let dismissed = false;
		let prevented = false;

		const handled = handleMessageInputKeydown(
			{
				key: "Escape",
				preventDefault: () => {
					prevented = true;
				},
			},
			{
				showSlashMenu: false,
				filteredCommandCount: 0,
				selectedIndex: 0,
				interruptible: true,
				isComposing: false,
				showMentionMenu: true,
				mentionItemCount: 4,
				mentionSelectedIndex: 0,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => true,
				submitValue: () => {},
				setMentionSelectedIndex: () => {},
				applySelectedMention: () => {},
				dismissMentionMenu: () => {
					dismissed = true;
				},
			},
		);

		expect(handled).toBe(true);
		expect(dismissed).toBe(true);
		expect(prevented).toBe(true);
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
				showMentionMenu: false,
				mentionItemCount: 0,
				mentionSelectedIndex: 0,
			},
			{
				setSelectedIndex: () => {},
				applySelectedSlashCommand: () => {},
				sendStopCommand: () => false,
				submitValue: () => {
					submitted = true;
				},
				setMentionSelectedIndex: () => {},
				applySelectedMention: () => {},
				dismissMentionMenu: () => {},
			},
		);

		expect(handled).toBe(false);
		expect(submitted).toBe(false);
		expect(prevented).toBe(false);
	});
});
