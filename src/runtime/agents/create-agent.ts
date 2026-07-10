import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertValidAgentName } from "../../common/agent-name.ts";
import { createOutclawLayout } from "../../common/layout.ts";
import { seedTemplates } from "../prompt/seed-templates.ts";
import { assertDefaultCronUserAllowed } from "./config/agent-config.ts";
import { writeAgentConfig } from "./config/write-agent-config.ts";

interface CreateAgentOptions {
	allowedUsers?: number[];
	botToken?: string;
	createAgentId?: () => string;
	defaultCronUserId?: number;
	homeDir: string;
	name: string;
	rolloverIdleMinutes?: number;
	templatesDir: string;
}

export function createAgent(options: CreateAgentOptions) {
	assertValidAgentName(options.name);
	assertDefaultCronUserAllowed(
		options.allowedUsers ?? [],
		options.defaultCronUserId,
	);

	const agentHomeDir = createOutclawLayout({
		homeDir: options.homeDir,
	}).agent(options.name).homeDir;
	if (existsSync(agentHomeDir)) {
		throw new Error(`Agent already exists: ${options.name}`);
	}

	mkdirSync(agentHomeDir, { recursive: true });
	const agentId = (options.createAgentId ?? randomUUID)();
	writeFileSync(join(agentHomeDir, ".agent-id"), `${agentId}\n`);
	seedTemplates(agentHomeDir, options.templatesDir, {
		agentName: options.name,
	});
	const configPath = writeAgentConfig({
		agentId,
		config: {
			...(options.rolloverIdleMinutes !== undefined
				? {
						rollover: {
							idleMinutes: options.rolloverIdleMinutes,
						},
					}
				: {}),
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
