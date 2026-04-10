import { describe, expect, test } from "bun:test";
import {
	BUILTIN_COMMANDS,
	MAX_VISIBLE_ITEMS,
	matchCommands,
	visibleWindow,
} from "../../../../src/frontend/tui/command-menu/state.ts";

describe("BUILTIN_COMMANDS", () => {
	test("includes runtime commands", () => {
		const commands = BUILTIN_COMMANDS.map((c) => c.command);
		expect(commands).toContain("/new");
		expect(commands).toContain("/model");
		expect(commands).toContain("/thinking");
		expect(commands).toContain("/session");
		expect(commands).toContain("/status");
		expect(commands).toContain("/stop");
	});

	test("does not include model aliases", () => {
		const commands = BUILTIN_COMMANDS.map((c) => c.command);
		expect(commands).not.toContain("/opus");
		expect(commands).not.toContain("/sonnet");
		expect(commands).not.toContain("/haiku");
	});

	test("includes /exit", () => {
		const commands = BUILTIN_COMMANDS.map((c) => c.command);
		expect(commands).toContain("/exit");
	});

	test("every item has a command and description", () => {
		for (const item of BUILTIN_COMMANDS) {
			expect(item.command).toMatch(/^\/\w+/);
			expect(item.description.length).toBeGreaterThan(0);
		}
	});

	test("has no duplicate commands", () => {
		const commands = BUILTIN_COMMANDS.map((c) => c.command);
		expect(new Set(commands).size).toBe(commands.length);
	});
});

describe("matchCommands", () => {
	test("returns empty for non-slash input", () => {
		expect(matchCommands("hello")).toEqual([]);
		expect(matchCommands("")).toEqual([]);
	});

	test("returns all commands for bare slash, sorted alphabetically", () => {
		const results = matchCommands("/");
		expect(results).toHaveLength(BUILTIN_COMMANDS.length);
		const commands = results.map((r) => r.command);
		const sorted = [...commands].sort();
		expect(commands).toEqual(sorted);
	});

	test("filters by prefix", () => {
		const results = matchCommands("/mo");
		expect(results).toHaveLength(1);
		expect(results[0]?.command).toBe("/model");
	});

	test("returns empty when input has a space (command with args)", () => {
		expect(matchCommands("/model opus")).toEqual([]);
	});

	test("returns empty when input ends with a space", () => {
		expect(matchCommands("/model ")).toEqual([]);
	});

	test("excludes model aliases from results", () => {
		const results = matchCommands("/op");
		expect(results.some((r) => r.command === "/opus")).toBe(false);
	});

	test("matches exact command", () => {
		const results = matchCommands("/new");
		expect(results).toHaveLength(1);
		expect(results[0]?.command).toBe("/new");
	});

	test("is case-insensitive", () => {
		const results = matchCommands("/NEW");
		expect(results.some((r) => r.command === "/new")).toBe(true);
	});

	test("returns multiple matches for shared prefix", () => {
		const results = matchCommands("/s");
		const commands = results.map((r) => r.command);
		expect(commands).toContain("/session");
		expect(commands).toContain("/status");
		expect(commands).toContain("/stop");
	});

	test("returns empty for unmatched prefix", () => {
		expect(matchCommands("/zzz")).toEqual([]);
	});
});

describe("matchCommands with skills", () => {
	const skills = [
		{ name: "commit", description: "Create a git commit" },
		{ name: "review", description: "Review code changes" },
	];

	test("includes skills in results", () => {
		const results = matchCommands("/", skills);
		const commands = results.map((r) => r.command);
		expect(commands).toContain("/commit");
		expect(commands).toContain("/review");
	});

	test("filters skills by prefix", () => {
		const results = matchCommands("/co", skills);
		expect(results).toHaveLength(1);
		expect(results[0]?.command).toBe("/commit");
	});

	test("does not duplicate built-in commands that match skill names", () => {
		const overlapping = [{ name: "new", description: "Skill new" }];
		const results = matchCommands("/new", overlapping);
		expect(results).toHaveLength(1);
		expect(results[0]?.description).toBe("Start a new conversation");
	});

	test("sorts all items alphabetically for bare slash", () => {
		const results = matchCommands("/", skills);
		const commands = results.map((r) => r.command);
		const sorted = [...commands].sort();
		expect(commands).toEqual(sorted);
	});
});

describe("visibleWindow", () => {
	const items = matchCommands("/");

	test("returns all items when fewer than MAX_VISIBLE_ITEMS", () => {
		const few = items.slice(0, 3);
		const result = visibleWindow(few, 0);
		expect(result.items).toEqual(few);
		expect(result.startIndex).toBe(0);
	});

	test("limits to MAX_VISIBLE_ITEMS", () => {
		expect(items.length).toBeGreaterThan(MAX_VISIBLE_ITEMS);
		const result = visibleWindow(items, 0);
		expect(result.items).toHaveLength(MAX_VISIBLE_ITEMS);
	});

	test("scrolls to keep selected item visible", () => {
		const result = visibleWindow(items, items.length - 1);
		expect(result.startIndex).toBe(items.length - MAX_VISIBLE_ITEMS);
		expect(result.items).toHaveLength(MAX_VISIBLE_ITEMS);
	});

	test("centers selection when possible", () => {
		const mid = Math.floor(items.length / 2);
		const result = visibleWindow(items, mid);
		expect(result.startIndex).toBeLessThanOrEqual(mid);
		expect(result.startIndex + MAX_VISIBLE_ITEMS).toBeGreaterThan(mid);
	});
});
