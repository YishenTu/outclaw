import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiDriver } from "../../../src/backend/adapters/pi/driver.ts";
import {
	OUTCLAW_NATIVE_TOOL_CATALOG,
	type OutclawNativeToolHost,
} from "../../../src/common/native-tools.ts";

interface CapturedPiTool {
	description: string;
	name: string;
	parameters: unknown;
	promptGuidelines?: string[];
	execute(
		toolCallId: string,
		params: unknown,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	): Promise<unknown>;
}

describe("Pi driver", () => {
	test("loads runtime resources without injecting Pi-only oc guidance", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const capturedResources: {
			appendSystemPrompt?: string[];
			systemPrompt?: string;
		} = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createResourceSdk(session, capturedResources),
		});

		try {
			for await (const _event of driver.run({
				prompt: "Use native Outclaw instructions",
				instructionMode: "runtime_constructed",
				systemPrompt: "Outclaw runtime system",
				model: "anthropic/claude-sonnet-4-5",
			})) {
				// drain
			}

			expect(capturedResources.systemPrompt).toBe("Outclaw runtime system");
			expect(capturedResources.appendSystemPrompt).toEqual([]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("loads only the Outclaw agent-local skills directory", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const agentHome = join(homeDir, ".outclaw", "agents", "demo");
		const skillsDir = join(agentHome, "skills");
		const session = new ImmediateSession();
		const settingsManager = {};
		const capturedOptions: Array<Record<string, unknown>> = [];
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () =>
				createResourceLoaderOptionsSdk(
					session,
					settingsManager,
					capturedOptions,
				),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Use an Outclaw skill",
					instructionMode: "runtime_constructed",
					systemPrompt: "Outclaw runtime system",
					cwd: agentHome,
					skillRootDir: skillsDir,
					model: "anthropic/claude-sonnet-4-5",
				}),
			);

			expect(capturedOptions).toEqual([
				expect.objectContaining({
					cwd: agentHome,
					agentDir: join(homeDir, ".pi", "outclaw", "agent"),
					noContextFiles: true,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					additionalExtensionPaths: [
						join(homeDir, ".pi", "outclaw", "agent", "extensions"),
					],
					additionalSkillPaths: [skillsDir],
					settingsManager,
					systemPrompt: "Outclaw runtime system",
				}),
			]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("loads Pi SDK extensions with the Outclaw agent directory in the environment", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const paths = piTestPaths(homeDir);
		const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		const captured: {
			duringReload?: string;
			duringCreateSession?: string;
		} = {};
		const driver = createPiDriver({
			paths,
			loadSdk: async () => createAgentDirEnvSdk(session, captured),
		});

		try {
			process.env.PI_CODING_AGENT_DIR = "/tmp/global-pi-agent";

			await drainRun(
				driver.run({
					prompt: "Use a profile-local extension",
					instructionMode: "runtime_constructed",
					systemPrompt: "Outclaw runtime system",
					model: "anthropic/claude-sonnet-4-5",
				}),
			);

			expect(captured.duringReload).toBe(paths.agentDir);
			expect(captured.duringCreateSession).toBe(paths.agentDir);
		} finally {
			if (originalAgentDir === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = originalAgentDir;
			}
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("rejects fresh sessions without an explicit model", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createResourceSdk(session, {}),
		});

		try {
			await expect(
				drainRun(
					driver.run({
						prompt: "Start without a model",
						instructionMode: "provider_default",
					}),
				),
			).rejects.toThrow("Pi fresh sessions require an explicit model");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("rejects explicit model ids that are not configured", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createResourceSdk(session, {}),
		});

		try {
			await expect(
				drainRun(
					driver.run({
						prompt: "Use a missing model",
						instructionMode: "provider_default",
						model: "anthropic/not-a-model",
					}),
				),
			).rejects.toThrow("Pi model anthropic/not-a-model is not configured");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("rejects unqualified model ids instead of picking a provider match", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createResourceSdk(session, {}),
		});

		try {
			await expect(
				drainRun(
					driver.run({
						prompt: "Use an ambiguous model id",
						instructionMode: "provider_default",
						model: "claude-sonnet-4-5",
					}),
				),
			).rejects.toThrow("Pi model claude-sonnet-4-5 is not configured");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("passes selected service tier through session-scoped extension metadata", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: { sessionStartEvent?: unknown } = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createSessionStartEventSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Use fast mode",
					instructionMode: "provider_default",
					model: "openai-codex/gpt-5.5",
					serviceTier: "priority",
				}),
			);

			expect(captured.sessionStartEvent).toEqual({
				type: "session_start",
				reason: "startup",
				outclaw: { serviceTier: "priority" },
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("uses an in-memory session manager for ephemeral fresh runs", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: { sessionManagerKind?: string } = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createSessionManagerChoiceSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Generate title",
					instructionMode: "runtime_constructed",
					systemPrompt: "Title only",
					model: "anthropic/claude-sonnet-4-5",
					preferredSessionId: "oc-title-probe",
					ephemeral: true,
				}),
			);

			expect(captured.sessionManagerKind).toBe("inMemory");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("advertises provider-qualified model values that can start a run", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createResourceSdk(session, {}),
		});

		try {
			if (!driver.listModels) {
				throw new Error("Pi driver should support model listing");
			}
			const [model] = await driver.listModels();

			expect(model).toMatchObject({
				id: "anthropic/claude-sonnet-4-5",
				model: "anthropic/claude-sonnet-4-5",
				defaultReasoningEffort: "medium",
				supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
			});
			await drainRun(
				driver.run({
					prompt: "Use listed model",
					instructionMode: "provider_default",
					model: model?.model,
				}),
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("passes prompt images to the Pi SDK as base64 image content", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const imagePath = join(homeDir, "image.png");
		writeFileSync(imagePath, Buffer.from([1, 2, 3]));
		const session = new ImmediateSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createResourceSdk(session, {}),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Describe this",
					images: [{ path: imagePath, mediaType: "image/png" }],
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
				}),
			);

			expect(session.promptText).toBe("Describe this");
			expect(session.promptOptions).toEqual({
				expandPromptTemplates: false,
				images: [
					{
						type: "image",
						data: Buffer.from([1, 2, 3]).toString("base64"),
						mimeType: "image/png",
					},
				],
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("does not expose provider-native effort names in model catalogs", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () =>
				createModelListSdk([
					sdkModel("anthropic", "claude-sonnet-4-5", {
						thinkingLevelMap: {
							minimal: "minimal",
							low: "low",
							medium: "medium",
							high: "high",
							xhigh: "xhigh",
						},
					}),
					sdkModel("openai", "fast", { reasoning: false }),
				]),
		});

		try {
			if (!driver.listModels) {
				throw new Error("Pi driver should support model listing");
			}

			await expect(driver.listModels()).resolves.toEqual([
				expect.objectContaining({
					id: "anthropic/claude-sonnet-4-5",
					defaultReasoningEffort: "medium",
					supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
				}),
				expect.objectContaining({
					id: "openai/fast",
					defaultReasoningEffort: "medium",
					supportedReasoningEfforts: [],
				}),
			]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("leaves service tiers unset when the Pi SDK model has no tier metadata", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () =>
				createModelListSdk([sdkModel("openai-codex", "gpt-5.5")]),
		});

		try {
			if (!driver.listModels) {
				throw new Error("Pi driver should support model listing");
			}

			const [model] = await driver.listModels();

			expect(model).not.toHaveProperty("serviceTiers");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("rejects resumed sessions when Pi cannot inherit the persisted model", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () =>
				createModelFallbackSdk(
					session,
					"Could not restore model anthropic/missing. Using anthropic/claude-sonnet-4-5",
				),
		});

		try {
			await expect(
				drainRun(
					driver.run({
						prompt: "Resume without fallback",
						instructionMode: "provider_default",
						resumeSessionId: "pi-session",
					}),
				),
			).rejects.toThrow(
				"Pi could not inherit the persisted model: Could not restore model anthropic/missing. Using anthropic/claude-sonnet-4-5",
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("injects session env into Pi bash tool subprocesses", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: { env?: NodeJS.ProcessEnv } = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createSessionEnvSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Use the session environment",
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
					sessionEnv: {
						OC_MEMORY_ROOT: "/tmp/outclaw-memory",
						OC_SESSION_ID: "oc-session-1",
					},
				}),
			);

			expect(captured.env).toMatchObject({
				PATH: "/usr/bin",
				OC_MEMORY_ROOT: "/tmp/outclaw-memory",
				OC_SESSION_ID: "oc-session-1",
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("registers native Outclaw tools with the Pi SDK when a host is supplied", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: {
			customTools?: CapturedPiTool[];
		} = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createNativeToolSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Use native Outclaw tools",
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
					nativeToolHost: testNativeToolHost(),
				}),
			);

			expect(captured.customTools?.map((tool) => tool.name)).toEqual(
				OUTCLAW_NATIVE_TOOL_CATALOG.map((tool) => tool.name),
			);
			expect(captured.customTools?.map((tool) => tool.description)).toEqual(
				OUTCLAW_NATIVE_TOOL_CATALOG.map((tool) => tool.description),
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("keeps read-only native Outclaw tools active in read-only Pi sessions", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: {
			customTools?: CapturedPiTool[];
			tools?: string[];
		} = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createNativeToolSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Use read-only native Outclaw tools",
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
					nativeToolHost: testNativeToolHost(),
					readOnly: true,
				}),
			);

			expect(captured.tools).toEqual([
				"read",
				"grep",
				"find",
				"ls",
				"outclaw_peer_message",
				"outclaw_recall",
				"outclaw_schema",
				"outclaw_cron",
				"outclaw_coding",
			]);
			expect(captured.tools).not.toContain("outclaw_memory_note");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("advertises only read-only native Outclaw modes in read-only Pi sessions", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: {
			customTools?: CapturedPiTool[];
			tools?: string[];
		} = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createNativeToolSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Use read-only native Outclaw tools",
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
					nativeToolHost: testNativeToolHost(),
					readOnly: true,
				}),
			);

			const schemas = new Map(
				captured.customTools?.map((tool) => [tool.name, tool.parameters]) ?? [],
			);

			expect(captured.customTools?.map((tool) => tool.name)).toEqual([
				"outclaw_peer_message",
				"outclaw_recall",
				"outclaw_schema",
				"outclaw_cron",
				"outclaw_coding",
			]);
			expect(nativeModeNames(schemas.get("outclaw_peer_message"))).toEqual([
				"list",
			]);
			expect(nativeModeNames(schemas.get("outclaw_cron"))).toEqual([
				"failed_status",
			]);
			expect(nativeModeNames(schemas.get("outclaw_coding"))).toEqual([
				"list",
				"status",
				"transcript",
			]);
			expect(
				nativeModeProperties(schemas.get("outclaw_peer_message")),
			).not.toHaveProperty("targetAgent");
			expect(
				nativeModeProperties(schemas.get("outclaw_coding")),
			).not.toHaveProperty("prompt");
			expect(
				nativeModeProperties(schemas.get("outclaw_coding")),
			).not.toHaveProperty("block");
			expect(
				captured.customTools?.find((tool) => tool.name === "outclaw_coding")
					?.description,
			).not.toContain("start");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("registers OpenAI-compatible schemas for native Outclaw tools", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: { customTools?: CapturedPiTool[] } = {};
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createNativeToolSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Use native Outclaw tools",
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
					nativeToolHost: testNativeToolHost(),
				}),
			);

			const schemas = new Map(
				captured.customTools?.map((tool) => [tool.name, tool.parameters]) ?? [],
			);

			expect(schemas.get("outclaw_memory_note")).toMatchObject({
				type: "object",
				additionalProperties: false,
				required: ["text"],
				properties: {
					text: { type: "string" },
					salience: {
						type: "string",
						enum: [
							"correction",
							"confirmation",
							"decision",
							"surprise",
							"routine",
						],
					},
					title: { type: "string" },
					tags: { type: "array", items: { type: "string" } },
				},
			});
			for (const schema of schemas.values()) {
				expect(forbiddenOpenAiTopLevelSchemaKeywords(schema)).toEqual([]);
			}
			expect(nativeModeNames(schemas.get("outclaw_coding"))).toEqual([
				"list",
				"start",
				"resume",
				"status",
				"transcript",
				"cancel",
			]);
			expect(nativeModeProperties(schemas.get("outclaw_coding"))).toMatchObject(
				{
					repository: { type: "string" },
					includeArchived: { type: "boolean" },
					limit: { type: "number" },
					target: { type: "string" },
					prompt: { type: "string" },
					sessionRef: { type: "string" },
				},
			);
			expect(nativeRequiredFields(schemas.get("outclaw_coding"))).toEqual([
				"mode",
			]);
			expect(nativeRequiredFields(schemas.get("outclaw_cron"))).toEqual([
				"mode",
			]);
			expect(nativeModeProperties(schemas.get("outclaw_cron"))).toMatchObject({
				jobName: { type: "string" },
				sinceEpochMs: { type: "number" },
				limit: { type: "number" },
			});
			expect(
				nativeModeProperties(schemas.get("outclaw_peer_message")),
			).toHaveProperty("timeoutSeconds");
			expect(nativeRequiredFields(schemas.get("outclaw_peer_message"))).toEqual(
				["mode"],
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("native Outclaw Pi tool calls validate params before calling the host", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const captured: { customTools?: CapturedPiTool[] } = {};
		const notes: unknown[] = [];
		const host = {
			...testNativeToolHost(),
			memoryNote: async (params) => {
				notes.push(params);
				return {
					ok: true,
					data: {
						path: "/memory/daily.md",
						timestamp: 1234,
					},
				} as const;
			},
		} satisfies OutclawNativeToolHost;
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createNativeToolSdk(session, captured),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Write memory",
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
					nativeToolHost: host,
				}),
			);

			const tool = captured.customTools?.find(
				(candidate) => candidate.name === "outclaw_memory_note",
			);
			if (!tool) {
				throw new Error("outclaw_memory_note tool was not registered");
			}
			const okResult = {
				ok: true,
				data: {
					path: "/memory/daily.md",
					timestamp: 1234,
				},
			};
			await expect(
				tool.execute("call-1", { text: "Remember native tools" }),
			).resolves.toEqual({
				content: [{ type: "text", text: JSON.stringify(okResult) }],
				details: okResult,
			});
			await expect(tool.execute("call-2", { text: "" })).resolves.toEqual({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							ok: false,
							error: {
								code: "validation_error",
								message: "text is required",
							},
						}),
					},
				],
				details: {
					ok: false,
					error: {
						code: "validation_error",
						message: "text is required",
					},
				},
			});
			expect(notes).toEqual([{ text: "Remember native tools" }]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("emits usage updates and done cost from Pi session stats", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new UsageSession({
			stats: {
				sessionFile: undefined,
				sessionId: "pi-session",
				userMessages: 1,
				assistantMessages: 1,
				toolCalls: 0,
				toolResults: 0,
				totalMessages: 2,
				tokens: {
					input: 130,
					output: 25,
					cacheRead: 20,
					cacheWrite: 15,
					total: 190,
				},
				cost: 0.25,
				contextUsage: {
					tokens: 80_000,
					contextWindow: 200_000,
					percent: 40,
				},
			},
		});
		const nowValues = [1000, 1042, 1050];
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createUsageSdk(session),
			now: () => nowValues.shift() ?? 1050,
		});

		try {
			const events = [];
			for await (const event of driver.run({
				prompt: "Track usage",
				instructionMode: "provider_default",
				model: "anthropic/claude-sonnet-4-5",
			})) {
				events.push(event);
			}

			const usage = {
				inputTokens: 130,
				outputTokens: 25,
				cacheCreationTokens: 15,
				cacheReadTokens: 20,
				contextWindow: 200_000,
				maxOutputTokens: 32_000,
				contextTokens: 80_000,
				percentage: 40,
			};
			expect(events).toEqual([
				{ type: "session_started", sessionId: "pi-session" },
				{ type: "usage", sessionId: "pi-session", usage },
				{
					type: "done",
					sessionId: "pi-session",
					durationMs: 42,
					timestamp: 1050,
					costUsd: 0.25,
					usage,
				},
			]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("falls back to assistant message usage when Pi stats are unavailable", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new UsageSession({
			messageUsage: {
				input: 100,
				output: 30,
				cacheRead: 40,
				cacheWrite: 5,
				totalTokens: 145,
				cost: {
					input: 0.01,
					output: 0.02,
					cacheRead: 0.003,
					cacheWrite: 0.004,
					total: 0.037,
				},
			},
		});
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createUsageSdk(session),
		});

		try {
			const events = [];
			for await (const event of driver.run({
				prompt: "Track usage without stats",
				instructionMode: "provider_default",
				model: "anthropic/claude-sonnet-4-5",
			})) {
				events.push(event);
			}

			const usage = {
				inputTokens: 100,
				outputTokens: 30,
				cacheCreationTokens: 5,
				cacheReadTokens: 40,
				contextWindow: 200_000,
				maxOutputTokens: 32_000,
				contextTokens: 145,
				percentage: 0,
			};
			expect(events).toContainEqual({
				type: "usage",
				sessionId: "pi-session",
				usage,
			});
			expect(events.at(-1)).toMatchObject({
				type: "done",
				sessionId: "pi-session",
				costUsd: 0.037,
				usage,
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("disposes completed Pi sessions after a run finishes", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new ImmediateSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createResourceSdk(session, {}),
		});

		try {
			await drainRun(
				driver.run({
					prompt: "Finish cleanly",
					instructionMode: "provider_default",
					model: "anthropic/claude-sonnet-4-5",
				}),
			);

			expect(session.disposed).toBe(true);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("emits abort without a successful done event when Pi resolves after abort", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const session = new AbortResolvingSession();
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () => createRunSdk(session),
			now: () => 1000,
		});
		const abortController = new AbortController();

		try {
			const iterator = driver
				.run({
					prompt: "Stop",
					instructionMode: "provider_default",
					abortSignal: abortController.signal,
					model: "anthropic/claude-sonnet-4-5",
				})
				[Symbol.asyncIterator]();

			await expect(iterator.next()).resolves.toEqual({
				done: false,
				value: { type: "session_started", sessionId: "pi-session" },
			});

			abortController.abort();

			const remaining = [];
			for (;;) {
				const next = await iterator.next();
				if (next.done) {
					break;
				}
				remaining.push(next.value);
			}

			expect(remaining).toEqual([
				{
					type: "turn_aborted",
					sessionId: "pi-session",
					timestamp: 1000,
				},
			]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("skips unsupported persisted message roles when reading Pi sessions", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () =>
				createReadSdk([
					{
						type: "message",
						timestamp: "2026-01-01T00:00:00.000Z",
						message: {
							role: "user",
							content: "Question",
							timestamp: 10,
						},
					},
					{
						type: "message",
						timestamp: "2026-01-01T00:00:01.000Z",
						message: {
							role: "toolResult",
							content: [{ type: "text", text: "tool output" }],
							timestamp: 20,
						},
					},
					{
						type: "message",
						timestamp: "2026-01-01T00:00:02.000Z",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "Answer" }],
							timestamp: 30,
						},
					},
				]),
		});

		try {
			await expect(driver.readSession("pi-session")).resolves.toEqual({
				id: "pi-session",
				messages: [
					{ role: "user", content: "Question", timestamp: 10 },
					{
						role: "assistant",
						segments: [{ type: "text", text: "Answer" }],
						timestamp: 30,
					},
				],
				entries: [
					{
						type: "message",
						message: { role: "user", content: "Question", timestamp: 10 },
					},
					{
						type: "message",
						message: {
							role: "assistant",
							segments: [{ type: "text", text: "Answer" }],
							timestamp: 30,
						},
					},
				],
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	test("reads Pi session branch entries with compactions and prompt images", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "outclaw-pi-sdk-home-"));
		const driver = createPiDriver({
			paths: piTestPaths(homeDir),
			loadSdk: async () =>
				createReadSdk(
					[
						{
							type: "message",
							timestamp: "2026-01-01T00:00:00.000Z",
							message: {
								role: "user",
								content: [
									{ type: "text", text: "Question" },
									{
										type: "image",
										data: "AQID",
										mimeType: "image/png",
									},
								],
							},
						},
						{
							type: "message",
							timestamp: "2026-01-01T00:00:01.000Z",
							message: {
								role: "toolResult",
								content: [{ type: "text", text: "tool output" }],
							},
						},
					],
					[
						{
							type: "message",
							timestamp: "2026-01-01T00:00:00.000Z",
							message: {
								role: "user",
								content: [
									{ type: "text", text: "Question" },
									{
										type: "image",
										data: "AQID",
										mimeType: "image/png",
									},
								],
							},
						},
						{
							type: "compaction",
							id: "compact-entry",
							parentId: "user-entry",
							timestamp: "2026-01-01T00:00:01.000Z",
							summary: "Previous work",
							firstKeptEntryId: "entry-2",
							tokensBefore: 120_000,
							details: {
								readFiles: ["AGENTS.md"],
								modifiedFiles: [],
							},
							fromHook: false,
						},
						{
							type: "message",
							timestamp: "2026-01-01T00:00:02.000Z",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "Answer" }],
							},
						},
					],
				),
		});

		try {
			await expect(driver.readSession("pi-session")).resolves.toEqual({
				id: "pi-session",
				messages: [
					{
						role: "user",
						content: "Question",
						images: [
							{
								kind: "inline",
								base64: "AQID",
								mediaType: "image/png",
							},
						],
						timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
					},
					{
						role: "assistant",
						segments: [{ type: "text", text: "Answer" }],
						timestamp: Date.parse("2026-01-01T00:00:02.000Z"),
					},
				],
				entries: [
					{
						type: "message",
						message: {
							role: "user",
							content: "Question",
							images: [
								{
									kind: "inline",
									base64: "AQID",
									mediaType: "image/png",
								},
							],
							timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
						},
					},
					{
						type: "compaction",
						timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
						tokensBefore: 120_000,
					},
					{
						type: "message",
						message: {
							role: "assistant",
							segments: [{ type: "text", text: "Answer" }],
							timestamp: Date.parse("2026-01-01T00:00:02.000Z"),
						},
					},
				],
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});

async function drainRun(run: AsyncIterable<unknown>) {
	for await (const _event of run) {
		// drain
	}
}

function piTestPaths(homeDir: string) {
	return {
		agentDir: join(homeDir, ".pi", "outclaw", "agent"),
		extensionDir: join(homeDir, ".pi", "outclaw", "agent", "extensions"),
		sharedAuthFile: join(homeDir, ".pi", "agent", "auth.json"),
	};
}

class ImmediateSession {
	readonly sessionId = "pi-session";
	disposed = false;
	promptText: string | undefined;
	promptOptions: unknown;

	dispose() {
		this.disposed = true;
	}

	async prompt(text: string, options?: unknown) {
		this.promptText = text;
		this.promptOptions = options;
	}

	async abort() {}

	subscribe() {
		return () => {};
	}
}

interface PiUsageFixture {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

class UsageSession {
	readonly sessionId = "pi-session";
	private readonly listeners: Array<(event: unknown) => void> = [];

	constructor(
		private readonly options: {
			messageUsage?: PiUsageFixture;
			stats?: unknown;
		},
	) {}

	dispose() {}

	async prompt() {
		for (const listener of this.listeners) {
			listener({
				type: "message_end",
				message: {
					role: "assistant",
					content: [],
					api: "anthropic-messages",
					provider: "anthropic",
					model: "claude-sonnet-4-5",
					usage: this.options.messageUsage ?? {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "stop",
					timestamp: 123,
				},
			});
		}
	}

	async abort() {}

	subscribe(listener: (event: unknown) => void) {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) {
				this.listeners.splice(index, 1);
			}
		};
	}

	getSessionStats() {
		return this.options.stats;
	}
}

class AbortResolvingSession {
	readonly sessionId = "pi-session";
	private aborted = false;
	private resolveAbort!: () => void;
	private readonly abortResolved = new Promise<void>((resolve) => {
		this.resolveAbort = resolve;
	});

	dispose() {}

	async prompt() {
		if (!this.aborted) {
			await this.abortResolved;
		}
		await this.abortResolved;
	}

	async abort() {
		this.aborted = true;
		this.resolveAbort();
	}

	subscribe() {
		return () => {};
	}
}

function createResourceSdk(
	session: ImmediateSession,
	capturedResources: {
		appendSystemPrompt?: string[];
		systemPrompt?: string;
	},
) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: ReloadableResourceLoader,
		createAgentSession: async (options: {
			resourceLoader: ReloadableResourceLoader;
		}) => {
			capturedResources.systemPrompt = options.resourceLoader.getSystemPrompt();
			capturedResources.appendSystemPrompt =
				options.resourceLoader.getAppendSystemPrompt();
			return { session };
		},
	} as never;
}

function createResourceLoaderOptionsSdk(
	session: ImmediateSession,
	settingsManager: Record<string, unknown>,
	capturedOptions: Array<Record<string, unknown>>,
) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => settingsManager },
		DefaultResourceLoader: class extends ReloadableResourceLoader {
			constructor(options: Record<string, unknown>) {
				capturedOptions.push(options);
				super(
					options as {
						appendSystemPrompt?: string[];
						systemPrompt?: string;
					},
				);
			}
		},
		createAgentSession: async () => ({ session }),
	} as never;
}

function createAgentDirEnvSdk(
	session: ImmediateSession,
	captured: {
		duringReload?: string;
		duringCreateSession?: string;
	},
) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: class extends ReloadableResourceLoader {
			override async reload() {
				captured.duringReload = process.env.PI_CODING_AGENT_DIR;
				await super.reload();
			}
		},
		createAgentSession: async () => {
			captured.duringCreateSession = process.env.PI_CODING_AGENT_DIR;
			return { session };
		},
	} as never;
}

function createRunSdk(session: AbortResolvingSession) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: class {
			async reload() {}
		},
		createAgentSession: async () => ({ session }),
	} as never;
}

function createUsageSdk(session: UsageSession) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [
					sdkModel("anthropic", "claude-sonnet-4-5", {
						contextWindow: 200_000,
						maxTokens: 32_000,
					}),
				],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: ReloadableResourceLoader,
		createAgentSession: async () => ({ session }),
	} as never;
}

function createModelFallbackSdk(
	session: ImmediateSession,
	modelFallbackMessage: string,
) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: ReloadableResourceLoader,
		createAgentSession: async () => ({ session, modelFallbackMessage }),
	} as never;
}

function createSessionStartEventSdk(
	session: ImmediateSession,
	captured: { sessionStartEvent?: unknown },
) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("openai-codex", "gpt-5.5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: ReloadableResourceLoader,
		createAgentSession: async (options: { sessionStartEvent?: unknown }) => {
			captured.sessionStartEvent = options.sessionStartEvent;
			return { session };
		},
	} as never;
}

function createSessionEnvSdk(
	session: ImmediateSession,
	captured: { env?: NodeJS.ProcessEnv },
) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: ReloadableResourceLoader,
		createBashToolDefinition: (
			_cwd: string,
			options: {
				spawnHook: (context: {
					command: string;
					cwd: string;
					env: NodeJS.ProcessEnv;
				}) => { command: string; cwd: string; env: NodeJS.ProcessEnv };
			},
		) => ({
			name: "bash",
			label: "Bash",
			description: "Run shell commands",
			parameters: {},
			execute: async () => {
				captured.env = options.spawnHook({
					command: "printenv OC_SESSION_ID",
					cwd: "/workspace",
					env: { PATH: "/usr/bin" },
				}).env;
				return { content: [] };
			},
		}),
		createAgentSession: async (options: {
			customTools?: Array<{ execute: () => Promise<unknown>; name: string }>;
		}) => {
			await options.customTools
				?.find((tool) => tool.name === "bash")
				?.execute();
			return { session };
		},
	} as never;
}

function createNativeToolSdk(
	session: ImmediateSession,
	captured: {
		customTools?: CapturedPiTool[];
		tools?: string[];
	},
) {
	return {
		SessionManager: {
			create: () => ({ getSessionId: () => session.sessionId }),
			open: () => ({ getSessionId: () => session.sessionId }),
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: ReloadableResourceLoader,
		defineTool: (definition: CapturedPiTool) => definition,
		createAgentSession: async (options: {
			customTools?: CapturedPiTool[];
			tools?: string[];
		}) => {
			captured.customTools = options.customTools;
			captured.tools = options.tools;
			return { session };
		},
	} as never;
}

function nativeModeNames(schema: unknown): string[] {
	const mode = nativeModeProperties(schema).mode;
	if (!isRecord(mode) || !Array.isArray(mode.enum)) {
		throw new Error("Native tool mode schema is missing mode enum");
	}
	return mode.enum.filter(
		(value): value is string => typeof value === "string",
	);
}

function nativeModeProperties(schema: unknown): Record<string, unknown> {
	if (!isRecord(schema) || !isRecord(schema.properties)) {
		throw new Error("Native tool schema is missing properties");
	}
	return schema.properties;
}

function nativeRequiredFields(schema: unknown): string[] {
	if (!isRecord(schema) || !Array.isArray(schema.required)) {
		throw new Error("Native tool schema is missing required fields");
	}
	return schema.required.filter(
		(value): value is string => typeof value === "string",
	);
}

function forbiddenOpenAiTopLevelSchemaKeywords(schema: unknown): string[] {
	if (!isRecord(schema)) {
		return ["non_object_schema"];
	}
	return ["oneOf", "anyOf", "allOf", "enum", "not"].filter(
		(keyword) => keyword in schema,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function testNativeToolHost(): OutclawNativeToolHost {
	return {
		context: {
			agentId: "agent-default",
			agentName: "Default",
			source: "browser",
			readOnly: false,
		},
		peerMessage: async () => ({
			ok: true,
			data: {
				mode: "send",
				targetAgent: "Builder",
				accepted: true,
			},
		}),
		memoryNote: async () => ({
			ok: true,
			data: {
				path: "/memory/daily.md",
				timestamp: 1234,
			},
		}),
		recall: async () => ({
			ok: true,
			data: {
				mode: "sessions",
				sessions: [],
			},
		}),
		schema: async () => ({
			ok: true,
			data: {
				mode: "all",
				schemas: [],
			},
		}),
		cron: async () => ({
			ok: true,
			data: {
				mode: "failed_status",
				failures: [],
			},
		}),
		coding: async () => ({
			ok: true,
			data: {
				mode: "status",
				sessionRef: "codex/code-thread-1",
				status: "idle",
			},
		}),
	};
}

class ReloadableResourceLoader {
	private readonly appendSystemPromptSource: string[];
	private readonly systemPromptSource: string | undefined;
	private appendSystemPrompt: string[] = [];
	private systemPrompt: string | undefined;

	constructor(options: {
		appendSystemPrompt?: string[];
		systemPrompt?: string;
	}) {
		this.appendSystemPromptSource = options.appendSystemPrompt ?? [];
		this.systemPromptSource = options.systemPrompt;
	}

	async reload() {
		this.appendSystemPrompt = this.appendSystemPromptSource;
		this.systemPrompt = this.systemPromptSource;
	}

	getSystemPrompt() {
		return this.systemPrompt;
	}

	getAppendSystemPrompt() {
		return this.appendSystemPrompt;
	}
}

function createReadSdk(entries: unknown[], branchEntries?: unknown[]) {
	return {
		SessionManager: {
			listAll: async () => [{ id: "pi-session", path: "/session" }],
			open: () => ({
				getSessionId: () => "pi-session",
				getEntries: () => entries,
				...(branchEntries ? { getBranch: () => branchEntries } : {}),
			}),
		},
	} as never;
}

function createModelListSdk(models: unknown[]) {
	return {
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAvailable: () => models,
			}),
		},
	} as never;
}

function createSessionManagerChoiceSdk(
	session: ImmediateSession,
	captured: { sessionManagerKind?: string },
) {
	return {
		SessionManager: {
			create: () => {
				captured.sessionManagerKind = "create";
				return { getSessionId: () => session.sessionId };
			},
			inMemory: () => {
				captured.sessionManagerKind = "inMemory";
				return { getSessionId: () => session.sessionId };
			},
			open: () => {
				captured.sessionManagerKind = "open";
				return { getSessionId: () => session.sessionId };
			},
			listAll: async () => [{ id: session.sessionId, path: "/session" }],
		},
		AuthStorage: { create: () => ({}) },
		ModelRegistry: {
			inMemory: () => ({
				getAll: () => [sdkModel("anthropic", "claude-sonnet-4-5")],
				getAvailable: () => [],
			}),
		},
		SettingsManager: { inMemory: () => ({}) },
		DefaultResourceLoader: ReloadableResourceLoader,
		createAgentSession: async () => ({ session }),
	} as never;
}

function sdkModel(
	provider: string,
	id: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		name: id,
		provider,
		reasoning: true,
		...overrides,
	};
}
