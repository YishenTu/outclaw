import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { listSlashCommands } from "../../../src/common/commands.ts";
import { buildCodingSkillCommands } from "../../../src/frontend/browser/coding/coding-skill-commands.ts";
import { filterSlashCommands } from "../../../src/frontend/browser/components/chat/composer/message-input-behavior.ts";
import { SlashCommandMenu } from "../../../src/frontend/browser/components/chat/slash-command-menu.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";
import { buildSlashCommands } from "../../../src/frontend/browser/stores/slash-commands.ts";

describe("buildSlashCommands", () => {
	test("includes builtin commands before skill commands", () => {
		const commands = buildSlashCommands([
			{ name: "summarize", description: "Summarize selected content" },
			{ name: "draft", description: "Draft a reply" },
		]);

		expect(commands.some((entry) => entry.name === "agent")).toBe(true);
		expect(commands.some((entry) => entry.name === "compact")).toBe(true);
		expect(commands.slice(-2)).toEqual([
			{
				name: "draft",
				description: "Draft a reply",
				source: "skill",
				transport: "prompt",
			},
			{
				name: "summarize",
				description: "Summarize selected content",
				source: "skill",
				transport: "prompt",
			},
		]);
	});

	test("mirrors the command catalog for builtin discoverability", () => {
		const commands = buildSlashCommands([]);
		expect(commands).toEqual(
			listSlashCommands().map((command) => ({
				name: command.command,
				description: command.description,
				source: "builtin" as const,
				transport: command.transport,
			})),
		);
		expect(commands.some((entry) => entry.name === "coding")).toBe(false);
	});

	test("keeps builtin commands authoritative when skill names collide", () => {
		const commands = buildSlashCommands([
			{ name: "agent", description: "Shadow builtin" },
		]);

		expect(commands.filter((entry) => entry.name === "agent")).toEqual([
			{
				name: "agent",
				description: "Show or switch agents",
				source: "builtin",
				transport: "runtime",
			},
		]);
	});
});

describe("buildCodingSkillCommands", () => {
	test("builds Codex skill entries with dollar insertion without chat builtins", () => {
		const commands = buildCodingSkillCommands([
			{ name: "review", description: "Review changes", scope: "repo" },
			{ name: "commit", description: "Create commit", scope: "user" },
		]);

		expect(commands).toEqual([
			{
				name: "commit",
				description: "Create commit",
				source: "skill",
				transport: "prompt",
				displayPrefix: "$",
				insertPrefix: "$",
			},
			{
				name: "review",
				description: "Review changes",
				source: "skill",
				transport: "prompt",
				displayPrefix: "$",
				insertPrefix: "$",
			},
		]);
		expect(commands.some((entry) => entry.name === "agent")).toBe(false);
	});

	test("matches code-mode skills from slash or dollar triggers", () => {
		const commands = buildCodingSkillCommands([
			{ name: "review", description: "Review changes", scope: "repo" },
		]);

		expect(filterSlashCommands("/re", commands, ["/", "$"])).toEqual(commands);
		expect(filterSlashCommands("$re", commands, ["/", "$"])).toEqual(commands);
	});
});

describe("SlashCommandMenu", () => {
	test("renders an empty state for async command catalogs", () => {
		const html = renderToStaticMarkup(
			createElement(SlashCommandMenu, {
				commands: [],
				selectedIndex: 0,
				onSelect: () => {},
				emptyMessage: "Loading coding skills...",
			}),
		);

		expect(html).toContain("Loading coding skills...");
	});
});
