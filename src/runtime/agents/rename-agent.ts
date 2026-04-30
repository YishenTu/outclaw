import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertValidAgentName } from "../../common/agent-name.ts";
import { createOutclawLayout } from "../../common/layout.ts";

interface RenameAgentOptions {
	homeDir: string;
	newName: string;
	oldName: string;
}

export function renameAgent(options: RenameAgentOptions) {
	assertValidAgentName(options.oldName);
	assertValidAgentName(options.newName);

	const layout = createOutclawLayout({ homeDir: options.homeDir });
	const currentPath = layout.agent(options.oldName).homeDir;
	const nextPath = layout.agent(options.newName).homeDir;
	if (!existsSync(currentPath)) {
		throw new Error(`Agent does not exist: ${options.oldName}`);
	}
	if (existsSync(nextPath)) {
		throw new Error(`Agent already exists: ${options.newName}`);
	}

	renameSync(currentPath, nextPath);
	rewriteAgentInstructionsWorkspacePath(
		nextPath,
		options.oldName,
		options.newName,
	);
	return nextPath;
}

function rewriteAgentInstructionsWorkspacePath(
	agentHomeDir: string,
	oldName: string,
	newName: string,
) {
	const instructionsPath = join(agentHomeDir, "AGENTS.md");
	if (!existsSync(instructionsPath)) {
		return;
	}

	const currentContent = readFileSync(instructionsPath, "utf-8");
	const nextContent = currentContent.replaceAll(
		`~/.outclaw/agents/${oldName}/`,
		`~/.outclaw/agents/${newName}/`,
	);
	if (nextContent !== currentContent) {
		writeFileSync(instructionsPath, nextContent);
	}
}
