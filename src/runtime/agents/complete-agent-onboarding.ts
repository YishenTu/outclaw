import { createAgent } from "./create-agent.ts";
import { ensureGlobalEnvFile } from "./ensure-global-env-file.ts";

interface CompleteAgentOnboardingOptions {
	allowedUsers?: number[];
	botToken?: string;
	createAgentId?: () => string;
	homeDir: string;
	name: string;
	prepareWorkspace: (agentHomeDir: string) => void;
	templatesDir: string;
}

export function completeAgentOnboarding(
	options: CompleteAgentOnboardingOptions,
) {
	const created = createAgent({
		allowedUsers: options.allowedUsers,
		botToken: options.botToken,
		createAgentId: options.createAgentId,
		homeDir: options.homeDir,
		name: options.name,
		prepareWorkspace: options.prepareWorkspace,
		templatesDir: options.templatesDir,
	});
	ensureGlobalEnvFile(options.homeDir);
	return created;
}
