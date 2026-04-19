import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import { createSupervisor } from "../../../src/runtime/supervisor/create-supervisor.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

describe("createSupervisor browser routes", () => {
	let cleanup: (() => Promise<void>) | undefined;
	let tempDir: string | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	test("serves browser agent summaries over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [
						{
							agentId: "agent-railly",
							name: "railly",
							sessions: [],
						},
					],
				}),
				readAgentFile: async () => ({
					path: "AGENTS.md",
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "diff --git a/config.json b/config.json",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			activeAgentId: "agent-railly",
			agents: [
				{
					agentId: "agent-railly",
					name: "railly",
					sessions: [],
				},
			],
		});
	});

	test("serves browser file reads over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/files?path=AGENTS.md`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			path: "AGENTS.md",
			kind: "text",
			content: "# Agent\n",
			truncated: false,
		});
	});

	test("serves browser cron summaries over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [
					{
						name: "Morning check",
						path: "cron/morning.yaml",
						schedule: "0 9 * * *",
						model: "haiku",
						enabled: true,
					},
				],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				setAgentCronEnabled: async (_agentId, path, enabled) => ({
					name: "Morning check",
					path,
					schedule: "0 9 * * *",
					model: "haiku",
					enabled,
				}),
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/cron`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual([
			{
				name: "Morning check",
				path: "cron/morning.yaml",
				schedule: "0 9 * * *",
				model: "haiku",
				enabled: true,
			},
		]);
	});

	test("updates cron enabled state over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitCommit: async () => ({
					sha: "abc1234",
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				setAgentCronEnabled: async (_agentId, path, enabled) => ({
					name: "Morning check",
					path,
					schedule: "0 9 * * *",
					model: "haiku",
					enabled,
				}),
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/agents/agent-railly/cron`,
			{
				method: "PATCH",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					path: "cron/morning.yaml",
					enabled: false,
				}),
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			name: "Morning check",
			path: "cron/morning.yaml",
			schedule: "0 9 * * *",
			model: "haiku",
			enabled: false,
		});
	});

	test("serves browser git commit details over HTTP", async () => {
		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApi: {
				getAgentTerminalCwd: () => undefined,
				listAgentCron: async () => [],
				listAgentTree: async () => [],
				listAgents: () => ({
					activeAgentId: "agent-railly",
					agents: [],
				}),
				readAgentFile: async (_agentId, path) => ({
					path,
					kind: "text",
					content: "# Agent\n",
					truncated: false,
				}),
				readGitCommit: async (sha) => ({
					sha,
					author: {
						name: "Test User",
						email: "test@example.com",
						date: "2026-04-18T00:00:00.000Z",
					},
					message: "Second commit\n\nExpanded body",
					parents: [{ sha: "def5678" }],
					diff: "diff --git a/README.md b/README.md",
				}),
				readGitDiff: async () => ({
					path: "config.json",
					diff: "",
				}),
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: { commits: [], branchHeads: [] },
					files: [],
				}),
				setAgentCronEnabled: async () => {
					throw new Error("Not implemented");
				},
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(
			`http://localhost:${supervisor.port}/api/git/commit?sha=abc1234`,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			sha: "abc1234",
			author: {
				name: "Test User",
				email: "test@example.com",
				date: "2026-04-18T00:00:00.000Z",
			},
			message: "Second commit\n\nExpanded body",
			parents: [{ sha: "def5678" }],
			diff: "diff --git a/README.md b/README.md",
		});
	});

	test("serves the built browser app from the runtime root", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "outclaw-browser-app-"));
		writeFileSync(
			join(tempDir, "index.html"),
			"<!doctype html><html><body>OUTCLAW_BROWSER</body></html>",
		);

		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApp: {
				distDir: tempDir,
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(`http://localhost:${supervisor.port}/`);

		expect(response.status).toBe(200);
		expect(await response.text()).toContain("OUTCLAW_BROWSER");
	});

	test("returns oc build guidance when the browser app is missing", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "outclaw-browser-app-"));

		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApp: {
				distDir: tempDir,
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const response = await fetch(`http://localhost:${supervisor.port}/`);

		expect(response.status).toBe(503);
		expect(await response.text()).toContain("oc build && oc restart");
	});

	test("serves browser app assets and falls back to index.html for SPA routes", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "outclaw-browser-app-"));
		writeFileSync(
			join(tempDir, "index.html"),
			"<!doctype html><html><body>OUTCLAW_SPA</body></html>",
		);
		writeFileSync(join(tempDir, "app.js"), "console.log('browser-app');\n");

		const supervisor = createSupervisor({
			agents: [
				createAgentRuntime({
					agentId: "agent-railly",
					name: "railly",
					facade: new MockFacade(),
				}),
			],
			browserApp: {
				distDir: tempDir,
			},
			port: 0,
		});
		cleanup = () => supervisor.stop();

		const assetResponse = await fetch(
			`http://localhost:${supervisor.port}/app.js`,
		);
		expect(assetResponse.status).toBe(200);
		expect(await assetResponse.text()).toContain("browser-app");

		const routeResponse = await fetch(
			`http://localhost:${supervisor.port}/agents/railly`,
		);
		expect(routeResponse.status).toBe(200);
		expect(await routeResponse.text()).toContain("OUTCLAW_SPA");

		const missingAssetResponse = await fetch(
			`http://localhost:${supervisor.port}/missing.js`,
		);
		expect(missingAssetResponse.status).toBe(404);
	});
});
