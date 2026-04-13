import { SLASH_COMMANDS } from "../../../common/commands.ts";
import { MODEL_ALIAS_LIST } from "../../../common/models.ts";
import type { SkillInfo } from "../../../common/protocol.ts";

export interface CommandMenuItem {
	command: string;
	description: string;
}

const MODEL_ALIAS_COMMANDS = new Set(MODEL_ALIAS_LIST.map((a) => `/${a}`));

export const BUILTIN_COMMANDS: CommandMenuItem[] = [
	...SLASH_COMMANDS.map((rc) => ({
		command: `/${rc.command}`,
		description: rc.description,
	})),
	{ command: "/exit", description: "Exit the TUI" },
].filter((item) => !MODEL_ALIAS_COMMANDS.has(item.command));

function buildMenuCommands(skills: SkillInfo[]): CommandMenuItem[] {
	const skillItems: CommandMenuItem[] = skills.map((s) => ({
		command: `/${s.name}`,
		description: s.description,
	}));
	const builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.command));
	const uniqueSkills = skillItems.filter((s) => !builtinNames.has(s.command));
	return [...BUILTIN_COMMANDS, ...uniqueSkills];
}

export function matchCommands(
	input: string,
	skills: SkillInfo[] = [],
): CommandMenuItem[] {
	const normalized = input.trimStart();
	if (!normalized.startsWith("/")) return [];
	if (normalized.includes(" ")) return [];

	const commands = buildMenuCommands(skills);
	const query = normalized.toLowerCase();
	const matches = commands.filter((item) => item.command.startsWith(query));

	if (query === "/") {
		return matches.toSorted((a, b) => a.command.localeCompare(b.command));
	}
	return matches;
}

export const MAX_VISIBLE_ITEMS = 6;

export function visibleWindow(
	items: CommandMenuItem[],
	selectedIndex: number,
): { items: CommandMenuItem[]; startIndex: number } {
	if (items.length <= MAX_VISIBLE_ITEMS) {
		return { items, startIndex: 0 };
	}
	let start = selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2);
	start = Math.max(0, Math.min(start, items.length - MAX_VISIBLE_ITEMS));
	return {
		items: items.slice(start, start + MAX_VISIBLE_ITEMS),
		startIndex: start,
	};
}
