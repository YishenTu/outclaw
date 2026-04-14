import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "./create-agent.ts";

interface OnboardingIo {
	log(message: string): void;
	prompt(message: string): Promise<string>;
}

interface OnboardFirstAgentOptions {
	createAgentId?: () => string;
	homeDir: string;
	io: OnboardingIo;
	templatesDir: string;
}

export async function onboardFirstAgent(options: OnboardFirstAgentOptions) {
	options.io.log("No agents found. Let's set up your first one.");

	const name = (await options.io.prompt("Agent name: ")).trim();
	const botToken = (await options.io.prompt("Bot token: ")).trim();
	const allowedUsers = parseUsers(
		await options.io.prompt("Allowed user IDs (comma-separated): "),
	);
	const created = createAgent({
		allowedUsers,
		botToken,
		createAgentId: options.createAgentId,
		homeDir: options.homeDir,
		name,
		templatesDir: options.templatesDir,
	});
	ensureEnvFile(options.homeDir);
	return created;
}

function ensureEnvFile(homeDir: string) {
	const envPath = join(homeDir, ".env");
	if (!existsSync(envPath)) {
		writeFileSync(envPath, "");
	}
}

function parseUsers(value: string) {
	return value
		.split(",")
		.map((item) => Number(item.trim()))
		.filter((item) => Number.isInteger(item));
}
