import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createTempHomeDir() {
	return join(
		tmpdir(),
		`outclaw-startup-info-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
}

function writeAgentWorkspace(
	homeDir: string,
	name: string,
	options?: {
		missingFiles?: string[];
	},
) {
	const agentDir = join(homeDir, "agents", name);
	mkdirSync(agentDir, { recursive: true });

	const missingFiles = new Set(options?.missingFiles ?? []);
	const files = {
		".agent-id": `agent-${name}\n`,
		"AGENTS.md": "# AGENTS\n",
		"SOUL.md": "# SOUL\n",
		"USER.md": "# USER\n",
		"MEMORY.md": "# MEMORY\n",
		"HEARTBEAT.md": "# HEARTBEAT\n",
	} as const;

	for (const [filename, content] of Object.entries(files)) {
		if (!missingFiles.has(filename)) {
			writeFileSync(join(agentDir, filename), content);
		}
	}
}

async function loadCollectStartupInfo(caseId: string) {
	const module = await import(
		`../../../../src/frontend/tui/chrome/startup-info.ts?case=${caseId}`
	);
	return module.collectStartupInfo;
}

describe("collectStartupInfo", () => {
	const createdDirs: string[] = [];

	afterEach(() => {
		for (const dir of createdDirs) {
			rmSync(dir, { force: true, recursive: true });
		}
		createdDirs.length = 0;
	});

	test("reports missing agent workspace files using multi-agent paths", async () => {
		const caseId = `missing-agent-file-${Date.now()}`;
		const homeDir = createTempHomeDir();
		createdDirs.push(homeDir);
		mkdirSync(homeDir, { recursive: true });
		writeFileSync(join(homeDir, "config.json"), "{}\n");
		writeAgentWorkspace(homeDir, "railly", {
			missingFiles: ["SOUL.md"],
		});
		const collectStartupInfo = await loadCollectStartupInfo(caseId);

		const info = collectStartupInfo({
			getGitInfo: () => null,
			homeDir,
		});

		expect(info.missingFiles).toEqual(["agents/railly/SOUL.md"]);
	});

	test("reports missing root config and durable agent id files", async () => {
		const caseId = `missing-root-config-${Date.now()}`;
		const homeDir = createTempHomeDir();
		createdDirs.push(homeDir);
		mkdirSync(homeDir, { recursive: true });
		writeAgentWorkspace(homeDir, "railly", {
			missingFiles: [".agent-id"],
		});
		const collectStartupInfo = await loadCollectStartupInfo(caseId);

		const info = collectStartupInfo({
			getGitInfo: () => null,
			homeDir,
		});

		expect(info.missingFiles).toEqual([
			"agents/railly/.agent-id",
			"config.json",
		]);
	});

	test("reports a missing agents directory when no agents exist", async () => {
		const caseId = `missing-agents-dir-${Date.now()}`;
		const homeDir = createTempHomeDir();
		createdDirs.push(homeDir);
		mkdirSync(homeDir, { recursive: true });
		writeFileSync(join(homeDir, "config.json"), "{}\n");
		const collectStartupInfo = await loadCollectStartupInfo(caseId);

		const info = collectStartupInfo({
			getGitInfo: () => null,
			homeDir,
		});

		expect(info.missingFiles).toEqual(["agents/"]);
	});

	test("returns no missing files for a healthy multi-agent workspace", async () => {
		const caseId = `healthy-workspace-${Date.now()}`;
		const homeDir = createTempHomeDir();
		createdDirs.push(homeDir);
		mkdirSync(homeDir, { recursive: true });
		writeFileSync(join(homeDir, "config.json"), "{}\n");
		writeAgentWorkspace(homeDir, "mimi");
		writeAgentWorkspace(homeDir, "railly");
		const collectStartupInfo = await loadCollectStartupInfo(caseId);

		const info = collectStartupInfo({
			getGitInfo: () => null,
			homeDir,
		});

		expect(info.missingFiles).toEqual([]);
	});
});
