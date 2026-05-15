import type { SkillInfo } from "../../../common/protocol.ts";

const HIDDEN_SKILLS = new Set([
	"batch",
	"claude-api",
	"debug",
	"loop",
	"schedule",
	"simplify",
	"update-config",
]);

export async function extractClaudeSkills(
	conversation: {
		supportedCommands(): Promise<{ name: string; description: string }[]>;
	},
	initEvent: { skills?: string[] },
): Promise<SkillInfo[]> {
	const skillNames = new Set(initEvent.skills ?? []);
	if (skillNames.size === 0) return [];

	try {
		const commands = await conversation.supportedCommands();
		return commands
			.filter((c) => skillNames.has(c.name) && !HIDDEN_SKILLS.has(c.name))
			.map((c) => ({ name: c.name, description: c.description }));
	} catch {
		return [...skillNames].map((name) => ({ name, description: "" }));
	}
}

export async function cleanupClaudeSessionFile(
	deps: {
		sleep: (ms: number) => Promise<void>;
		unlinkFile: (path: string) => void;
	},
	cwd: string | undefined,
	sessionId: string,
): Promise<void> {
	const dir = cwd ?? process.cwd();
	const encodedCwd = dir.replaceAll("/", "-");
	const path = `${process.env.HOME}/.claude/projects/${encodedCwd}/${sessionId}.jsonl`;

	// SDK writes the JSONL asynchronously after abort.
	await deps.sleep(500);

	try {
		deps.unlinkFile(path);
	} catch {
		// Cleanup is best-effort.
	}
}
