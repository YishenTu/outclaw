import { describe, expect, test } from "bun:test";
import {
	canSubmitMessageInput,
	filterSlashCommands,
	isSlashAutocompleteInput,
	resolveRuntimePopupItemCount,
	shouldShowSlashCommandMenu,
} from "../../../src/frontend/browser/components/chat/composer/message-input-behavior.ts";

const COMMANDS = [
	{
		name: "agent",
		description: "Switch agent",
		source: "builtin" as const,
		transport: "runtime" as const,
	},
	{
		name: "status",
		description: "Show status",
		source: "builtin" as const,
		transport: "runtime" as const,
	},
	{
		name: "stop",
		description: "Stop run",
		source: "builtin" as const,
		transport: "runtime" as const,
	},
];

describe("browser message input behavior", () => {
	test("detects slash autocomplete input and filters commands", () => {
		expect(isSlashAutocompleteInput("/st")).toBe(true);
		expect(isSlashAutocompleteInput("/st now")).toBe(false);
		expect(isSlashAutocompleteInput("hello")).toBe(false);
		expect(filterSlashCommands("/st", COMMANDS)).toEqual([
			{
				name: "status",
				description: "Show status",
				source: "builtin",
				transport: "runtime",
			},
			{
				name: "stop",
				description: "Stop run",
				source: "builtin",
				transport: "runtime",
			},
		]);
		expect(filterSlashCommands("/ST", COMMANDS)).toEqual([
			{
				name: "status",
				description: "Show status",
				source: "builtin",
				transport: "runtime",
			},
			{
				name: "stop",
				description: "Stop run",
				source: "builtin",
				transport: "runtime",
			},
		]);
	});

	test("counts runtime popup options by kind", () => {
		expect(
			resolveRuntimePopupItemCount({
				kind: "agent",
				agents: [{ agentId: "agent-a", name: "alpha" }],
			}),
		).toBe(1);
		expect(
			resolveRuntimePopupItemCount({
				kind: "session",
				sessions: [{ sdkSessionId: "sdk-a", title: "A", lastActive: 1 }],
			}),
		).toBe(1);
		expect(resolveRuntimePopupItemCount({ kind: "status" })).toBe(0);
		expect(resolveRuntimePopupItemCount(null)).toBe(0);
	});

	test("opens the command menu for an empty async catalog when an empty message is configured", () => {
		expect(
			shouldShowSlashCommandMenu({
				filteredCommandCount: 0,
				hasEmptyMessage: true,
				isTriggerActive: true,
				showMentionMenu: false,
			}),
		).toBe(true);
		expect(
			shouldShowSlashCommandMenu({
				filteredCommandCount: 0,
				hasEmptyMessage: false,
				isTriggerActive: true,
				showMentionMenu: false,
			}),
		).toBe(false);
	});

	test("allows submission only with text or images while enabled", () => {
		expect(
			canSubmitMessageInput({
				disabled: false,
				imageCount: 0,
				submitting: false,
				value: "hello",
			}),
		).toBe(true);
		expect(
			canSubmitMessageInput({
				disabled: false,
				imageCount: 1,
				submitting: false,
				value: "   ",
			}),
		).toBe(true);
		expect(
			canSubmitMessageInput({
				disabled: true,
				imageCount: 1,
				submitting: false,
				value: "hello",
			}),
		).toBe(false);
		expect(
			canSubmitMessageInput({
				disabled: false,
				imageCount: 0,
				submitting: true,
				value: "hello",
			}),
		).toBe(false);
	});
});
