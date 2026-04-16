import { afterEach, describe, expect, test } from "bun:test";
import { createAgentRuntime } from "../../../src/runtime/application/create-agent-runtime.ts";
import { createSupervisor } from "../../../src/runtime/supervisor/create-supervisor.ts";
import { MockFacade } from "../../helpers/mock-facade.ts";

describe("createSupervisor browser routes", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
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
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: "",
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
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: "",
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
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: "",
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
				readGitStatus: async () => ({
					root: "/tmp/.outclaw",
					branch: "main",
					ahead: 0,
					behind: 0,
					clean: true,
					graph: "",
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
});
