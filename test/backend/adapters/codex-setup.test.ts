import { describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { CodexAdapter } from "../../../src/backend/adapters/codex/index.ts";
import {
	CODEX_AGENT_PROJECT_CONFIG,
	ensureCodexAgentWorkspace,
} from "../../../src/backend/adapters/codex/setup.ts";
import type {
	CodexAppServerClient,
	CodexServerNotification,
} from "../../../src/backend/adapters/codex/types.ts";

class RecordingCodexClient implements CodexAppServerClient {
	readonly initialize = mock(async () => {});
	readonly notify = mock((_method: string, _params?: unknown) => {});
	readonly dispose = mock(async () => {});
	readonly requests: Array<{ method: string; params: unknown }> = [];
	private readonly responses: Map<
		string,
		(params: unknown) => Record<string, unknown>
	> = new Map();

	stub(method: string, fn: (params: unknown) => Record<string, unknown>): void {
		this.responses.set(method, fn);
	}

	async request<T>(method: string, params: unknown): Promise<T> {
		this.requests.push({ method, params });
		const stub = this.responses.get(method);
		if (!stub) {
			throw new Error(`Unexpected request: ${method}`);
		}
		return stub(params) as T;
	}

	subscribe(
		_handler: (notification: CodexServerNotification) => void,
	): () => void {
		return () => {};
	}
}

describe("Codex workspace setup", () => {
	test("creates skills/, .codex/config.toml, and .codex/skills symlink in the agent home", () => {
		const agentHome = mkdtempSync(join(tmpdir(), "codex-workspace-"));
		try {
			ensureCodexAgentWorkspace(agentHome);

			expect(existsSync(join(agentHome, "skills"))).toBe(true);
			expect(existsSync(join(agentHome, ".codex", "config.toml"))).toBe(true);
			expect(existsSync(join(agentHome, ".codex", "skills"))).toBe(true);

			// Symlink target points at the canonical skill source so the user's
			// skill files live under agentHome/skills, not in a Codex-only path.
			const link = require("node:fs").readlinkSync(
				join(agentHome, ".codex", "skills"),
			);
			expect(link.split(sep).join("/")).toBe("../skills");
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	});

	test("agent .codex/config.toml ships personality and disables multi_agent / memories", () => {
		const agentHome = mkdtempSync(join(tmpdir(), "codex-workspace-"));
		try {
			ensureCodexAgentWorkspace(agentHome);

			const config = readFileSync(
				join(agentHome, ".codex", "config.toml"),
				"utf8",
			);

			expect(config).toContain('personality = "friendly"');
			expect(config).toContain("[features]");
			expect(config).toContain("multi_agent = false");
			expect(config).toContain("memories = false");
			// The project layer must not duplicate chat model defaults or the
			// approval/sandbox policy — those are owned by Outclaw runtime state
			// and the adapter request layer.
			expect(config).not.toContain("model");
			expect(config).not.toContain("approval_policy");
			expect(config).not.toContain("sandbox");
			expect(config).toBe(CODEX_AGENT_PROJECT_CONFIG);
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	});

	test("CodexAdapter.prepareWorkspace materializes the agent workspace", () => {
		const agentHome = mkdtempSync(join(tmpdir(), "codex-workspace-"));
		try {
			const adapter = new CodexAdapter({
				client: new RecordingCodexClient(),
			});

			adapter.prepareWorkspace(agentHome);

			expect(existsSync(join(agentHome, ".codex", "config.toml"))).toBe(true);
			expect(existsSync(join(agentHome, ".codex", "skills"))).toBe(true);
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	});
});

describe("CodexAdapter.ensureProjectTrusted", () => {
	test("writes project trust with a map upsert so dotted paths stay one project key", async () => {
		const client = new RecordingCodexClient();
		client.stub("config/batchWrite", () => ({}));
		client.stub("config/read", () => ({
			config: {
				personality: "friendly",
				features: { multi_agent: false, memories: false },
			},
		}));
		const adapter = new CodexAdapter({ client });

		await adapter.ensureProjectTrusted("/home/.outclaw/agents/agent");

		expect(client.requests).toEqual([
			{
				method: "config/batchWrite",
				params: {
					edits: [
						{
							keyPath: "projects",
							value: {
								"/home/.outclaw/agents/agent": {
									trust_level: "trusted",
								},
							},
							mergeStrategy: "upsert",
						},
					],
					reloadUserConfig: true,
				},
			},
			{
				method: "config/read",
				params: { cwd: "/home/.outclaw/agents/agent" },
			},
		]);
	});

	test("is idempotent — repeated trust calls for the same agentHome do not re-write", async () => {
		const client = new RecordingCodexClient();
		client.stub("config/batchWrite", () => ({}));
		client.stub("config/read", () => ({
			config: {
				personality: "friendly",
				features: { multi_agent: false, memories: false },
			},
		}));
		const adapter = new CodexAdapter({ client });

		await adapter.ensureProjectTrusted("/home/agent");
		await adapter.ensureProjectTrusted("/home/agent");

		const batchWrites = client.requests.filter(
			(r) => r.method === "config/batchWrite",
		);
		expect(batchWrites).toHaveLength(1);
	});

	test("Codex Chat run calls ensureProjectTrusted before thread/start", async () => {
		const client = new RecordingCodexClient();
		client.stub("config/batchWrite", () => ({}));
		client.stub("config/read", () => ({
			config: {
				personality: "friendly",
				features: { multi_agent: false, memories: false },
			},
		}));
		client.stub("thread/start", () => ({
			thread: { id: "codex-thread-1", path: null },
		}));
		client.stub("turn/start", () => ({
			turn: { id: "turn-1", durationMs: 0 },
		}));
		const adapter = new CodexAdapter({ client });

		const iterator = adapter
			.run({
				prompt: "hi",
				cwd: "/home/agent",
				instructionPolicy: {
					mode: "runtime_constructed",
					systemPrompt: "be helpful",
				},
			})
			[Symbol.asyncIterator]();
		// Pull events until thread/start has been issued, then stop.
		// Driving the loop to terminal requires a turn/completed notification
		// which this fake client does not synthesize.
		while (!client.requests.some((r) => r.method === "thread/start")) {
			await iterator.next();
		}
		await iterator.return?.();

		const methods = client.requests.map((r) => r.method);
		const batchIdx = methods.indexOf("config/batchWrite");
		const startIdx = methods.indexOf("thread/start");
		expect(batchIdx).toBeGreaterThanOrEqual(0);
		expect(startIdx).toBeGreaterThan(batchIdx);
	});

	test("Codex Code Mode (provider_default) does not call ensureProjectTrusted", async () => {
		const client = new RecordingCodexClient();
		client.stub("thread/start", () => ({
			thread: { id: "codex-thread-1", path: null },
		}));
		client.stub("turn/start", () => ({
			turn: { id: "turn-1", durationMs: 0 },
		}));
		const adapter = new CodexAdapter({ client });

		const iterator = adapter
			.run({
				prompt: "x",
				cwd: "/repo",
				instructionPolicy: { mode: "provider_default" },
			})
			[Symbol.asyncIterator]();
		while (!client.requests.some((r) => r.method === "thread/start")) {
			await iterator.next();
		}
		await iterator.return?.();

		// Code Mode keeps Codex defaults; the trust step is a chat-only
		// invariant for loading the agent-local project config.
		expect(client.requests.some((r) => r.method === "config/batchWrite")).toBe(
			false,
		);
	});

	test("rejects when config/read does not report the project layer (no personality/features)", async () => {
		const client = new RecordingCodexClient();
		client.stub("config/batchWrite", () => ({}));
		// Simulate Codex silently falling back to user-global config —
		// neither personality nor features came from the project layer.
		client.stub("config/read", () => ({ config: {} }));
		const adapter = new CodexAdapter({ client });

		await expect(adapter.ensureProjectTrusted("/home/agent")).rejects.toThrow(
			"project layer not loaded",
		);
	});

	test("rejects when config/read only reports user-global personality/features", async () => {
		const client = new RecordingCodexClient();
		client.stub("config/batchWrite", () => ({}));
		client.stub("config/read", () => ({
			config: {
				personality: "pragmatic",
				features: { memories: false },
			},
		}));
		const adapter = new CodexAdapter({ client });

		await expect(adapter.ensureProjectTrusted("/home/agent")).rejects.toThrow(
			"project layer not loaded",
		);
	});
});
