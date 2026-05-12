import type { ProviderSkillInfo } from "../../../common/protocol.ts";
import type { CommandEntry } from "../stores/slash-commands.ts";

export function buildCodingSkillCommands(
	skills: ProviderSkillInfo[],
): CommandEntry[] {
	return skills
		.slice()
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((skill) => ({
			name: skill.name,
			description: skill.description,
			source: "skill" as const,
			transport: "prompt" as const,
			displayPrefix: "$",
			insertPrefix: "$",
		}));
}
