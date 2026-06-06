import { describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOutclawPiExtensionBundleBanner } from "../../../src/backend/adapters/pi/extension-bundle.ts";
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
import type { OutclawNativeToolHost } from "../../../src/common/native-tools.ts";
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

function writeTestPiExtensionSources(sourceDir: string): void {
	writeFileSync(
		join(sourceDir, "outclaw-extension.ts"),
		[
			'import registerWebTools from "./web-tools.ts";',
			'import registerDefaultTools from "./default-tools.ts";',
			'import registerOutclawTools from "./outclaw-tools.ts";',
			"export default function registerOutclawExtension(pi: unknown) {",
			"\tregisterWebTools(pi);",
			"\tregisterDefaultTools(pi);",
			"\tregisterOutclawTools(pi);",
			"}",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(sourceDir, "web-tools.ts"),
		"export default function registerWebTools() {}\n",
	);
	writeFileSync(
		join(sourceDir, "default-tools.ts"),
		"export default function registerDefaultTools() {}\n",
	);
	writeFileSync(
		join(sourceDir, "outclaw-tools.ts"),
		"export default function registerOutclawTools() {}\n",
	);
}

function writeTestOutclawExtensionBundle(
	sourceDir: string,
	targetFile: string,
	body: string,
): void {
	mkdirSync(join(targetFile, ".."), { recursive: true });
	writeFileSync(
		targetFile,
		`${createOutclawPiExtensionBundleBanner(sourceDir)}${body}`,
	);
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

	test("passes native tool hosts through to the driver", async () => {
		const driver = new MockPiDriver();
		const adapter = new PiAdapter({ driver });
		const nativeToolHost = {} as OutclawNativeToolHost;

		for await (const _event of adapter.run({
			prompt: "Hi",
			nativeToolHost,
		})) {
			// drain
		}

		expect(driver.runParams).toEqual([
			{
				prompt: "Hi",
				instructionMode: "provider_default",
				nativeToolHost,
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

	test("sets up the Outclaw extension package manifest without dropping custom entries", () => {
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
							custom: "^1.0.0",
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
				custom: "^1.0.0",
				jsdom: "^29.1.1",
			});
			expect(packageJson.pi).toEqual({
				extensions: ["./outclaw/index.js", "./custom-tool.ts"],
				skills: ["./skills"],
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("rejects malformed Pi extension manifests before building extensions", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "outclaw-pi-extensions-"));
		try {
			const paths = getPiProfilePaths(homeDir);
			writeTestPiExtensionSources(sourceDir);
			mkdirSync(paths.extensionDir, { recursive: true });
			const packageJsonPath = join(paths.extensionDir, "package.json");
			writeFileSync(packageJsonPath, "{ not json\n");
			let buildCount = 0;

			expect(() =>
				ensurePiProfile(paths, {
					extensionSourceDir: sourceDir,
					buildOutclawExtensionBundle: ({ targetFile }) => {
						buildCount += 1;
						writeTestOutclawExtensionBundle(
							sourceDir,
							targetFile,
							"web_search web_fetch outclaw_peer_message\n",
						);
					},
				}),
			).toThrow(/Invalid Pi extension manifest/);
			expect(buildCount).toBe(0);
			expect(readFileSync(packageJsonPath, "utf8")).toBe("{ not json\n");
			expect(existsSync(join(paths.extensionDir, "outclaw", "index.js"))).toBe(
				false,
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(sourceDir, { recursive: true, force: true });
		}
	});

	test("syncs the repo-owned Pi extension package into the Pi profile", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		try {
			const paths = getPiProfilePaths(homeDir);
			mkdirSync(paths.extensionDir, { recursive: true });
			writeFileSync(join(paths.extensionDir, "web-tools.ts"), "legacy");
			writeFileSync(join(paths.extensionDir, "web-tools.js"), "legacy");
			writeFileSync(join(paths.extensionDir, "default-tools.ts"), "legacy");
			writeFileSync(join(paths.extensionDir, "outclaw-tools.ts"), "legacy");
			writeFileSync(join(paths.extensionDir, "package-lock.json"), "{}\n");
			mkdirSync(join(paths.extensionDir, "node_modules"), { recursive: true });

			ensurePiProfile(paths);

			const packageJson = JSON.parse(
				readFileSync(join(paths.extensionDir, "package.json"), "utf8"),
			);
			expect(packageJson.dependencies).toBeUndefined();
			expect(packageJson.pi.extensions).toEqual(["./outclaw/index.js"]);
			for (const entry of packageJson.pi.extensions) {
				expect(existsSync(join(paths.extensionDir, entry.slice(2)))).toBe(true);
			}
			expect(existsSync(join(paths.extensionDir, "web-tools.ts"))).toBe(false);
			expect(existsSync(join(paths.extensionDir, "web-tools.js"))).toBe(false);
			expect(existsSync(join(paths.extensionDir, "default-tools.ts"))).toBe(
				false,
			);
			expect(existsSync(join(paths.extensionDir, "outclaw-tools.ts"))).toBe(
				false,
			);
			expect(existsSync(join(paths.extensionDir, "package-lock.json"))).toBe(
				false,
			);
			expect(existsSync(join(paths.extensionDir, "node_modules"))).toBe(false);
			const webToolsBundle = readFileSync(
				join(paths.extensionDir, "outclaw", "index.js"),
				"utf8",
			);
			expect(webToolsBundle).toContain("outclaw_peer_message");
			expect(webToolsBundle).toContain("web_search");
			expect(webToolsBundle).toContain("web_fetch");
			expect(webToolsBundle).not.toContain("web_context");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("generates the profile Outclaw extension bundle without mutating repo sources", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "outclaw-pi-extensions-"));
		try {
			const paths = getPiProfilePaths(homeDir);
			writeTestPiExtensionSources(sourceDir);
			let buildCount = 0;

			ensurePiProfile(paths, {
				extensionSourceDir: sourceDir,
				buildOutclawExtensionBundle: ({ extensionSourceDir, targetFile }) => {
					buildCount += 1;
					writeTestOutclawExtensionBundle(
						extensionSourceDir,
						targetFile,
						"export default function registerOutclawExtension() {} web_search web_fetch outclaw_peer_message\n",
					);
				},
			});

			expect(buildCount).toBe(1);
			expect(existsSync(join(sourceDir, "web-tools.js"))).toBe(false);
			expect(existsSync(join(paths.extensionDir, "outclaw", "index.js"))).toBe(
				true,
			);
			expect(
				readFileSync(join(paths.extensionDir, "outclaw", "index.js"), "utf8"),
			).toContain("registerOutclawExtension");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(sourceDir, { recursive: true, force: true });
		}
	});

	test("regenerates a stale profile Outclaw extension bundle before seeding", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "outclaw-pi-extensions-"));
		try {
			const paths = getPiProfilePaths(homeDir);
			writeTestPiExtensionSources(sourceDir);
			mkdirSync(join(paths.extensionDir, "outclaw"), { recursive: true });
			writeFileSync(
				join(paths.extensionDir, "outclaw", "index.js"),
				"export default function staleWebTools() {}\n",
			);
			let buildCount = 0;

			ensurePiProfile(paths, {
				extensionSourceDir: sourceDir,
				buildOutclawExtensionBundle: ({ extensionSourceDir, targetFile }) => {
					buildCount += 1;
					writeTestOutclawExtensionBundle(
						extensionSourceDir,
						targetFile,
						"export default function freshOutclawExtension() {} web_search web_fetch outclaw_peer_message\n",
					);
				},
			});

			expect(buildCount).toBe(1);
			expect(
				readFileSync(join(paths.extensionDir, "outclaw", "index.js"), "utf8"),
			).toContain("freshOutclawExtension");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(sourceDir, { recursive: true, force: true });
		}
	});

	test("regenerates a banner-current profile bundle when its body digest changes", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "outclaw-pi-extensions-"));
		try {
			const paths = getPiProfilePaths(homeDir);
			writeTestPiExtensionSources(sourceDir);
			let buildCount = 0;
			const buildOutclawExtensionBundle = ({
				extensionSourceDir,
				targetFile,
			}: {
				extensionSourceDir: string;
				targetFile: string;
			}) => {
				buildCount += 1;
				writeTestOutclawExtensionBundle(
					extensionSourceDir,
					targetFile,
					`export default function freshOutclawExtension${buildCount}() {} web_search web_fetch outclaw_peer_message\n`,
				);
			};

			ensurePiProfile(paths, {
				extensionSourceDir: sourceDir,
				buildOutclawExtensionBundle,
			});
			const bundlePath = join(paths.extensionDir, "outclaw", "index.js");
			writeFileSync(
				bundlePath,
				`${createOutclawPiExtensionBundleBanner(sourceDir)}web_search web_fetch outclaw_peer_message corrupted\n`,
			);

			ensurePiProfile(paths, {
				extensionSourceDir: sourceDir,
				buildOutclawExtensionBundle,
			});

			expect(buildCount).toBe(2);
			expect(readFileSync(bundlePath, "utf8")).toContain(
				"freshOutclawExtension2",
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(sourceDir, { recursive: true, force: true });
		}
	});

	test("prunes legacy managed dependencies when manifest entries are already current", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-home-"));
		const sourceDir = mkdtempSync(join(tmpdir(), "outclaw-pi-extensions-"));
		try {
			const paths = getPiProfilePaths(homeDir);
			writeTestPiExtensionSources(sourceDir);
			mkdirSync(paths.extensionDir, { recursive: true });
			writeFileSync(
				join(paths.extensionDir, "package.json"),
				`${JSON.stringify(
					{
						dependencies: {
							jsdom: "^29.1.1",
							linkedom: "^0.18.12",
						},
						pi: {
							extensions: ["./outclaw/index.js"],
						},
					},
					null,
					2,
				)}\n`,
			);

			ensurePiProfile(paths, {
				extensionSourceDir: sourceDir,
				buildOutclawExtensionBundle: ({ extensionSourceDir, targetFile }) => {
					writeTestOutclawExtensionBundle(
						extensionSourceDir,
						targetFile,
						"web_search web_fetch outclaw_peer_message\n",
					);
				},
			});

			const packageJson = JSON.parse(
				readFileSync(join(paths.extensionDir, "package.json"), "utf8"),
			);
			expect(packageJson.dependencies).toBeUndefined();
			expect(packageJson.pi.extensions).toEqual(["./outclaw/index.js"]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(sourceDir, { recursive: true, force: true });
		}
	});

	test("prepareWorkspace creates the canonical Outclaw skill root", () => {
		const promptHomeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-agent-"));
		let profileSetupCount = 0;
		const adapter = new PiAdapter({
			driver: new MockPiDriver(),
			setupProfile: () => {
				profileSetupCount += 1;
			},
		});
		try {
			adapter.prepareWorkspace(promptHomeDir);

			expect(profileSetupCount).toBe(1);
			expect(existsSync(join(promptHomeDir, "skills"))).toBe(true);
			expect(existsSync(join(promptHomeDir, ".pi", "skills"))).toBe(false);
			expect(existsSync(join(promptHomeDir, ".agents", "skills"))).toBe(false);
		} finally {
			rmSync(promptHomeDir, { recursive: true, force: true });
		}
	});
});
