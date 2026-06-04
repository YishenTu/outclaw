import { describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "../../../src/backend/adapters/pi/index.ts";
import {
	ensurePiProfile,
	getPiProfilePaths,
} from "../../../src/backend/adapters/pi/setup.ts";
import type {
	PiDriver,
	PiDriverEvent,
	PiDriverRunParams,
	PiDriverSession,
} from "../../../src/backend/adapters/pi/types.ts";
import { buildPromptWithReplyContext } from "../../../src/common/reply-context.ts";

class MockPiDriver implements PiDriver {
	readonly runParams: PiDriverRunParams[] = [];
	disposed = false;
	events: PiDriverEvent[] = [];
	session: PiDriverSession = { id: "pi-session", messages: [] };

	async *run(params: PiDriverRunParams): AsyncIterable<PiDriverEvent> {
		this.runParams.push(params);
		for (const event of this.events) {
			yield event;
		}
	}

	async readSession(): Promise<PiDriverSession> {
		return this.session;
	}

	async listModels() {
		return [
			{
				id: "anthropic/claude-sonnet-4-5",
				model: "claude-sonnet-4-5",
				displayName: "Claude Sonnet 4.5",
				description: "Pi Sonnet",
				isDefault: true,
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium", "high"],
				contextWindow: 200000,
				serviceTiers: [
					{
						id: "priority",
						name: "Priority",
						description: "Higher priority",
					},
				],
			},
		];
	}

	async dispose() {
		this.disposed = true;
	}
}

describe("PiAdapter", () => {
	test("implements provider roles and streams a simple run", async () => {
		const driver = new MockPiDriver();
		driver.events = [
			{ type: "session_started", sessionId: "pi-session" },
			{ type: "text_delta", text: "hello", sessionId: "pi-session" },
			{
				type: "done",
				sessionId: "pi-session",
				durationMs: 42,
				timestamp: 123,
			},
		];
		const adapter = new PiAdapter({ driver });

		const events = [];
		for await (const event of adapter.run({
			prompt: "Hi",
			sessionId: "oc-1",
		})) {
			events.push(event);
		}

		expect(adapter.providerId).toBe("pi");
		expect(driver.runParams).toEqual([
			{
				prompt: "Hi",
				preferredSessionId: "oc-1",
				instructionMode: "provider_default",
			},
		]);
		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "pi-session" },
			{ type: "text", text: "hello", sessionId: "pi-session" },
			{
				type: "done",
				sessionId: "pi-session",
				durationMs: 42,
				timestamp: 123,
			},
		]);
	});

	test("normalizes driver usage and cost events", async () => {
		const usage = {
			inputTokens: 10,
			outputTokens: 2,
			cacheCreationTokens: 3,
			cacheReadTokens: 4,
			contextWindow: 200_000,
			maxOutputTokens: 32_000,
			contextTokens: 100_000,
			percentage: 50,
		};
		const driver = new MockPiDriver();
		driver.events = [
			{ type: "session_started", sessionId: "pi-session" },
			{ type: "usage", usage, sessionId: "pi-session" },
			{
				type: "done",
				sessionId: "pi-session",
				durationMs: 42,
				timestamp: 123,
				costUsd: 0.25,
				usage,
			},
		];
		const adapter = new PiAdapter({ driver });

		const events = [];
		for await (const event of adapter.run({
			prompt: "Hi",
			sessionId: "oc-1",
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "session_initialized", sessionId: "pi-session" },
			{ type: "usage_updated", usage, sessionId: "pi-session" },
			{
				type: "done",
				sessionId: "pi-session",
				durationMs: 42,
				timestamp: 123,
				costUsd: 0.25,
				usage,
			},
		]);
	});

	test("maps runtime run params into driver run params", async () => {
		const driver = new MockPiDriver();
		const abortController = new AbortController();
		const adapter = new PiAdapter({ driver });

		for await (const _event of adapter.run({
			prompt: "Hi",
			instructionPolicy: {
				mode: "runtime_constructed",
				systemPrompt: "Outclaw system",
			},
			cwd: "/workspace",
			resourceHomeDir: "/workspace",
			model: "anthropic/claude-sonnet-4-5",
			effort: "high",
			serviceTier: "priority",
			stream: false,
			executionMode: "read_only",
			ephemeral: true,
			sessionEnv: { OC_SESSION_ID: "oc-1" },
			abortController,
			sessionId: "oc-1",
		})) {
			// drain
		}

		expect(driver.runParams).toEqual([
			{
				prompt: "Hi",
				preferredSessionId: "oc-1",
				instructionMode: "runtime_constructed",
				systemPrompt: "Outclaw system",
				cwd: "/workspace",
				skillRootDir: "/workspace/skills",
				model: "anthropic/claude-sonnet-4-5",
				effort: "high",
				serviceTier: "priority",
				stream: false,
				readOnly: true,
				ephemeral: true,
				sessionEnv: { OC_SESSION_ID: "oc-1" },
				abortSignal: abortController.signal,
			},
		]);
	});

	test("resumes by provider session id without sending a fresh preferred id", async () => {
		const driver = new MockPiDriver();
		const adapter = new PiAdapter({ driver });

		for await (const _event of adapter.run({
			prompt: "Resume",
			sessionId: "oc-ignored",
			resume: "pi-session",
			instructionPolicy: { mode: "provider_default" },
		})) {
			// drain
		}

		expect(driver.runParams).toEqual([
			{
				prompt: "Resume",
				resumeSessionId: "pi-session",
				instructionMode: "provider_default",
			},
		]);
	});

	test("passes prompt images through to the driver", async () => {
		const driver = new MockPiDriver();
		const adapter = new PiAdapter({ driver });

		for await (const _event of adapter.run({
			prompt: "Describe",
			images: [{ path: "/tmp/image.png", mediaType: "image/png" }],
		})) {
			// drain
		}

		expect(driver.runParams).toEqual([
			{
				prompt: "Describe",
				images: [{ path: "/tmp/image.png", mediaType: "image/png" }],
				instructionMode: "provider_default",
			},
		]);
	});

	test("maps driver failures to error events", async () => {
		const driver = new (class extends MockPiDriver {
			override async *run(): AsyncIterable<PiDriverEvent> {
				for (const event of this.events) {
					yield event;
				}
				throw new Error("driver exploded");
			}
		})();
		const adapter = new PiAdapter({ driver });
		const events = [];

		for await (const event of adapter.run({ prompt: "Hi" })) {
			events.push(event);
		}

		expect(events).toEqual([{ type: "error", message: "driver exploded" }]);
	});

	test("reads replay history from the driver session", async () => {
		const driver = new MockPiDriver();
		driver.session = {
			id: "pi-session",
			messages: [
				{
					role: "user",
					content: buildPromptWithReplyContext("Question", {
						text: "Earlier answer",
					}),
					timestamp: 100,
				},
				{
					role: "assistant",
					segments: [
						{ type: "thinking", text: "Plan" },
						{ type: "text", text: "Answer" },
						{ type: "thinking", text: "Check" },
					],
					timestamp: 200,
				},
			],
		};
		const adapter = new PiAdapter({ driver });

		await expect(adapter.readReplay("pi-session")).resolves.toEqual([
			{
				kind: "chat",
				role: "user",
				content: "Question",
				replyContext: { text: "Earlier answer" },
				timestamp: 100,
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Answer",
				thinking: "PlanCheck",
				thinkingBlocks: ["PlanCheck"],
				segments: [
					{ type: "thinking", text: "Plan" },
					{ type: "text", text: "Answer" },
					{ type: "thinking", text: "Check" },
				],
				timestamp: 200,
			},
		]);
	});

	test("reads persisted compaction boundaries from driver session entries", async () => {
		const driver = new MockPiDriver();
		driver.session = {
			id: "pi-session",
			messages: [
				{ role: "user", content: "Before", timestamp: 100 },
				{ role: "assistant", content: "After", timestamp: 200 },
			],
			entries: [
				{
					type: "message",
					message: { role: "user", content: "Before", timestamp: 100 },
				},
				{ type: "compaction", timestamp: 150, tokensBefore: 120_000 },
				{
					type: "message",
					message: { role: "assistant", content: "After", timestamp: 200 },
				},
			],
		};
		const adapter = new PiAdapter({ driver });

		await expect(adapter.readReplay("pi-session")).resolves.toEqual([
			{
				kind: "chat",
				role: "user",
				content: "Before",
				timestamp: 100,
			},
			{
				kind: "system",
				event: "compact_boundary",
				text: "context compacted",
				preTokens: 120_000,
			},
			{
				kind: "chat",
				role: "assistant",
				content: "After",
				timestamp: 200,
			},
		]);
		await expect(adapter.readTranscript("pi-session")).resolves.toEqual([
			{ role: "user", content: "Before", timestamp: 100 },
			{ role: "assistant", content: "After", timestamp: 200 },
		]);
	});

	test("omits assistant messages without displayable content from history", async () => {
		const driver = new MockPiDriver();
		driver.session = {
			id: "pi-session",
			messages: [
				{ role: "user", content: "Question", timestamp: 100 },
				{ role: "assistant", segments: [], timestamp: 150 },
				{ role: "assistant", content: "Answer", timestamp: 200 },
			],
		};
		const adapter = new PiAdapter({ driver });

		await expect(adapter.readReplay("pi-session")).resolves.toEqual([
			{
				kind: "chat",
				role: "user",
				content: "Question",
				timestamp: 100,
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Answer",
				timestamp: 200,
			},
		]);
		await expect(adapter.readTranscript("pi-session")).resolves.toEqual([
			{ role: "user", content: "Question", timestamp: 100 },
			{ role: "assistant", content: "Answer", timestamp: 200 },
		]);
	});

	test("omits non-finite timestamps from replay history", async () => {
		const driver = new MockPiDriver();
		driver.session = {
			id: "pi-session",
			messages: [
				{ role: "user", content: "Question", timestamp: Number.NaN },
				{
					role: "assistant",
					content: "Answer",
					timestamp: Number.POSITIVE_INFINITY,
				},
			],
		};
		const adapter = new PiAdapter({ driver });

		await expect(adapter.readReplay("pi-session")).resolves.toEqual([
			{
				kind: "chat",
				role: "user",
				content: "Question",
			},
			{
				kind: "chat",
				role: "assistant",
				content: "Answer",
			},
		]);
	});

	test("reads transcript turns only when driver messages have durable timestamps", async () => {
		const driver = new MockPiDriver();
		driver.session = {
			id: "pi-session",
			messages: [
				{ role: "user", content: "Question", timestamp: 100 },
				{ role: "assistant", content: "Answer", timestamp: 200 },
			],
		};
		const adapter = new PiAdapter({ driver });

		await expect(adapter.readTranscript("pi-session")).resolves.toEqual([
			{ role: "user", content: "Question", timestamp: 100 },
			{ role: "assistant", content: "Answer", timestamp: 200 },
		]);

		driver.session = {
			id: "pi-session",
			messages: [{ role: "assistant", content: "Missing timestamp" }],
		};

		await expect(adapter.readTranscript("pi-session")).rejects.toThrow(
			"Pi transcript export requires durable per-message timestamps",
		);

		driver.session = {
			id: "pi-session",
			messages: [
				{ role: "user", content: "Invalid timestamp", timestamp: Number.NaN },
			],
		};

		await expect(adapter.readTranscript("pi-session")).rejects.toThrow(
			"Pi transcript export requires durable per-message timestamps",
		);
	});

	test("lists models from the driver and disposes it", async () => {
		const driver = new MockPiDriver();
		const adapter = new PiAdapter({ driver });

		await expect(adapter.listModels()).resolves.toEqual([
			{
				id: "anthropic/claude-sonnet-4-5",
				model: "claude-sonnet-4-5",
				displayName: "Claude Sonnet 4.5",
				description: "Pi Sonnet",
				isDefault: true,
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium", "high"],
				contextWindow: 200000,
				serviceTiers: [
					{
						id: "priority",
						name: "Priority",
						description: "Higher priority",
					},
				],
			},
		]);

		await adapter.dispose();
		expect(driver.disposed).toBe(true);
	});

	test("sets up an Outclaw-scoped Pi profile without inheriting global resources", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		try {
			const paths = getPiProfilePaths(homeDir);

			expect(paths).toEqual({
				agentDir: join(homeDir, ".pi", "outclaw", "agent"),
				extensionDir: join(homeDir, ".pi", "outclaw", "agent", "extensions"),
				sharedAuthFile: join(homeDir, ".pi", "agent", "auth.json"),
			});

			ensurePiProfile(paths);

			expect(existsSync(paths.agentDir)).toBe(true);
			expect(lstatSync(paths.agentDir).isDirectory()).toBe(true);
			expect(existsSync(paths.extensionDir)).toBe(true);
			expect(lstatSync(paths.extensionDir).isDirectory()).toBe(true);
			for (const resourceName of [
				"settings.json",
				"models.json",
				"skills",
				"prompts",
				"AGENTS.md",
				"sessions",
			]) {
				expect(existsSync(join(paths.agentDir, resourceName))).toBe(false);
			}
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("sets up the Outclaw extension package manifest without dropping dependencies", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		try {
			const paths = getPiProfilePaths(homeDir);
			ensurePiProfile(paths);
			const packageJsonPath = join(paths.extensionDir, "package.json");
			writeFileSync(
				packageJsonPath,
				`${JSON.stringify(
					{
						dependencies: {
							jsdom: "^29.1.1",
						},
						pi: {
							extensions: ["./custom-tool.ts"],
							skills: ["./skills"],
						},
					},
					null,
					2,
				)}\n`,
			);

			ensurePiProfile(paths);

			const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
			expect(packageJson.dependencies).toEqual({
				jsdom: "^29.1.1",
			});
			expect(packageJson.pi).toEqual({
				extensions: [
					"./web-tools.ts",
					"./default-tools.ts",
					"./custom-tool.ts",
				],
				skills: ["./skills"],
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("prepareWorkspace creates the canonical Outclaw skill root", () => {
		const promptHomeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-agent-"));
		const adapter = new PiAdapter({ driver: new MockPiDriver() });
		try {
			adapter.prepareWorkspace(promptHomeDir);

			expect(existsSync(join(promptHomeDir, "skills"))).toBe(true);
			expect(existsSync(join(promptHomeDir, ".pi", "skills"))).toBe(false);
			expect(existsSync(join(promptHomeDir, ".agents", "skills"))).toBe(false);
		} finally {
			rmSync(promptHomeDir, { recursive: true, force: true });
		}
	});
});
