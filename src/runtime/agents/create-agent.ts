import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureClaudeSkillsSymlink } from "../../backend/adapters/claude-setup.ts";
import { seedTemplates } from "../prompt/seed-templates.ts";
import { assertDefaultCronUserAllowed } from "./agent-config.ts";
import { assertValidAgentName } from "./agent-name.ts";
import { writeAgentConfig } from "./write-agent-config.ts";

interface CreateAgentOptions {
	allowedUsers?: number[];
	botToken?: string;
	createAgentId?: () => string;
	defaultCronUserId?: number;
	homeDir: string;
	name: string;
	templatesDir: string;
}

export function createAgent(options: CreateAgentOptions) {
	assertValidAgentName(options.name);
	assertDefaultCronUserAllowed(
		options.allowedUsers ?? [],
		options.defaultCronUserId,
	);

	const agentsDir = join(options.homeDir, "agents");
	const agentHomeDir = join(agentsDir, options.name);
	if (existsSync(agentHomeDir)) {
		throw new Error(`Agent already exists: ${options.name}`);
	}

	mkdirSync(agentHomeDir, { recursive: true });
	const agentId = (options.createAgentId ?? randomUUID)();
	writeFileSync(join(agentHomeDir, ".agent-id"), `${agentId}\n`);
	seedTemplates(agentHomeDir, options.templatesDir, {
		agentName: options.name,
	});
	ensureClaudeSkillsSymlink(agentHomeDir);
	const configPath = writeAgentConfig({
		agentId,
		config: {
			telegram: {
				botToken: options.botToken ?? "",
				allowedUsers: options.allowedUsers ?? [],
				...(options.defaultCronUserId !== undefined
					? {
							defaultCronUserId: options.defaultCronUserId,
						}
					: {}),
			},
		},
		homeDir: options.homeDir,
	});

	return {
		agentHomeDir,
		agentId,
		configPath,
	};
}
