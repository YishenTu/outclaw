import { basename } from "node:path";
import { createOutclawLayout } from "../../common/layout.ts";
import {
	type AgentOnboardingSubmission,
	runAgentOnboardingTui,
} from "../../frontend/tui/onboarding/index.tsx";
import { completeAgentOnboarding } from "../../runtime/agents/complete-agent-onboarding.ts";
import { listAgents } from "../../runtime/agents/list-agents.ts";
import { updateGlobalConfig } from "../../runtime/config/index.ts";
import { secureAgentConfig } from "../../runtime/config/secure-agent-config.ts";
import { PidManager } from "../../runtime/process/pid-manager.ts";

interface OnboardCommandOptions {
	cliEntry: string;
	homeDir: string;
	templatesDir: string;
}

interface ApplyOnboardingSubmissionOptions {
	createAgentId?: () => string;
	homeDir: string;
	submission: AgentOnboardingSubmission;
	templatesDir: string;
}

interface RestartSpawnResult {
	exitCode?: number | null;
}

type RestartSpawn = (
	command: string[],
	options: {
		env: typeof process.env;
		stdio: ["inherit", "inherit", "inherit"];
	},
) => RestartSpawnResult;

export function applyOnboardingSubmission(
	options: ApplyOnboardingSubmissionOptions,
) {
	const created = completeAgentOnboarding({
		allowedUsers: options.submission.allowedUsers,
		botToken: options.submission.botToken,
		createAgentId: options.createAgentId,
		homeDir: options.homeDir,
		name: options.submission.name,
		templatesDir: options.templatesDir,
	});

	let securedConfig = false;
	if (options.submission.secureTelegramConfig) {
		securedConfig = secureAgentConfig(options.homeDir).changes.length > 0;
	}

	if (options.submission.enableLan) {
		updateGlobalConfig(options.homeDir, {
			host: "0.0.0.0",
		});
	}

	return {
		created,
		lanEnabled: options.submission.enableLan,
		securedConfig,
	};
}

export async function promptAndApplyOnboarding(
	options: Pick<OnboardCommandOptions, "homeDir" | "templatesDir">,
) {
	const submission = await runAgentOnboardingTui(
		listAgents(options.homeDir).length,
	);
	if (!submission) {
		return null;
	}

	return applyOnboardingSubmission({
		homeDir: options.homeDir,
		submission,
		templatesDir: options.templatesDir,
	});
}

export function restartDaemonViaCli(
	cliEntry: string,
	spawnSync: RestartSpawn = Bun.spawnSync as RestartSpawn,
) {
	const result = spawnSync(["bun", cliEntry, "restart"], {
		env: process.env,
		stdio: ["inherit", "inherit", "inherit"],
	});
	return result.exitCode ?? 1;
}

export async function onboardCommand(options: OnboardCommandOptions) {
	const applied = await promptAndApplyOnboarding(options);
	if (!applied) {
		console.log("Onboarding cancelled");
		process.exit(1);
		return;
	}

	console.log(`Created agent ${basename(applied.created.agentHomeDir)}`);
	console.log(applied.created.agentHomeDir);
	if (applied.securedConfig) {
		console.log("Moved hardcoded Telegram config into .env");
	}
	if (applied.lanEnabled) {
		console.log("Enabled LAN mode");
	}

	const pid = new PidManager(
		createOutclawLayout({ homeDir: options.homeDir }).pidPath,
	);
	if (!pid.isRunning()) {
		return;
	}

	console.log("Restarting daemon to apply onboarding changes...");
	process.exit(restartDaemonViaCli(options.cliEntry));
}
