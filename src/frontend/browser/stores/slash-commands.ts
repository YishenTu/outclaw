import { create } from "zustand";
import {
	listSlashCommands,
	type SlashCommandTransport,
} from "../../../common/commands.ts";
import type { SkillInfo } from "../../../common/protocol.ts";

export interface CommandEntry {
	name: string;
	description: string;
	source: "builtin" | "skill";
	transport: SlashCommandTransport;
}

export interface SlashCommandsState {
	commands: CommandEntry[];
	skills: SkillInfo[];

	setSkills: (skills: SkillInfo[]) => void;
	setCommands: (commands: CommandEntry[]) => void;
}

function createBuiltinCommandEntries(): CommandEntry[] {
	return listSlashCommands().map((command) => ({
		name: command.command,
		description: command.description,
		source: "builtin" as const,
		transport: command.transport,
	}));
}

export function buildSlashCommands(skills: SkillInfo[]): CommandEntry[] {
	const builtinEntries = createBuiltinCommandEntries();
	const builtinNames = new Set(builtinEntries.map((entry) => entry.name));
	const skillEntries = skills
		.filter((skill) => !builtinNames.has(skill.name))
		.slice()
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((skill) => ({
			name: skill.name,
			description: skill.description,
			source: "skill" as const,
			transport: "prompt" as const,
		}));

	return [...builtinEntries, ...skillEntries];
}

export const useSlashCommandsStore = create<SlashCommandsState>((set) => ({
	commands: buildSlashCommands([]),
	skills: [],
	setSkills: (skills) =>
		set({
			skills,
			commands: buildSlashCommands(skills),
		}),
	setCommands: (commands) => set({ commands }),
}));
