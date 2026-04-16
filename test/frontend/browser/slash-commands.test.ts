import { describe, expect, test } from "bun:test";
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
			},
			{
				name: "summarize",
				description: "Summarize selected content",
				source: "skill",
			},
		]);
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
			},
		]);
	});
});
