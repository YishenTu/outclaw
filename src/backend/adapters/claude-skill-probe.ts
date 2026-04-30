import type { SkillInfo } from "../../common/protocol.ts";

interface ClaudeSkillConversation extends AsyncIterable<unknown> {
	supportedCommands(): Promise<{ name: string; description: string }[]>;
}

interface ClaudeSkillProbeOptions {
	cwd?: string;
	query(params: { prompt: string; options?: unknown }): ClaudeSkillConversation;
	sleep: (ms: number) => Promise<void>;
	unlinkFile: (path: string) => void;
}

const HIDDEN_SKILLS = new Set([
	"batch",
	"claude-api",
	"debug",
	"loop",
	"schedule",
	"simplify",
	"update-config",
]);

export async function probeClaudeSkills(
	options: ClaudeSkillProbeOptions,
): Promise<SkillInfo[]> {
	const abortController = new AbortController();
	let sessionId: string | undefined;
	let skills: SkillInfo[] = [];

	try {
		const conversation = options.query({
			prompt: "",
			options: {
				abortController,
				cwd: options.cwd,
				permissionMode: "bypassPermissions",
				allowDangerouslySkipPermissions: true,
			},
		});

		for await (const event of conversation) {
			if (isClaudeInitEvent(event)) {
				sessionId = event.session_id;
				skills = await extractClaudeSkills(conversation, event);
				abortController.abort();
				break;
			}
		}
	} catch {
		// Probe is best-effort; swallow abort errors.
	}

	if (sessionId) {
		await cleanupProbeSession(
			{
				sleep: options.sleep,
				unlinkFile: options.unlinkFile,
			},
			options.cwd,
			sessionId,
		);
	}
	return skills;
}

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

function isClaudeInitEvent(event: unknown): event is {
	type: "system";
	subtype: "init";
	session_id?: string;
	skills?: string[];
} {
	if (!event || typeof event !== "object") {
		return false;
	}

	const record = event as Record<string, unknown>;
	return record.type === "system" && record.subtype === "init";
}

async function cleanupProbeSession(
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
