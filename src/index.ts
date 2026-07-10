import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { ClaudeAdapter } from "./backend/adapters/claude/index.ts";
import { CodexAdapter } from "./backend/adapters/codex/index.ts";
import { PiAdapter } from "./backend/adapters/pi/index.ts";
import { createOutclawLayout } from "./common/layout.ts";
import type { NativeToolResult } from "./common/native-tools.ts";
import type {
	BrowserChatCodingLinksChangedEvent,
	Facade,
	ImageMediaType,
	ProviderWorkspaceMetadata,
	SessionCursor,
} from "./common/protocol.ts";
import { extractError } from "./common/protocol.ts";
import { deriveTelegramBotId } from "./common/telegram.ts";
import type { TelegramMessageFileRecord } from "./frontend/telegram/files/message-file-ref.ts";
import { copyTelegramFile } from "./frontend/telegram/files/storage.ts";
import { createTelegramBotManager } from "./frontend/telegram/index.ts";
import { discoverAgents } from "./runtime/agents/discover-agents.ts";
import type { AgentRuntime } from "./runtime/application/create-agent-runtime.ts";
import { createAgentRuntime } from "./runtime/application/create-agent-runtime.ts";
import {
	type BrowserChatProviderCatalog,
	createBrowserApi,
} from "./runtime/browser/create-browser-api.ts";
import {
	ChatCodingLinkStore,
	CODING_STORAGE_OWNER_ID,
	CodingRepositoryStore,
	CodingSessionEventHub,
	CodingSessionStore,
	createCodingService,
} from "./runtime/coding/index.ts";
import { loadGlobalConfig } from "./runtime/config/index.ts";
import { createCronTelegramChatIdResolver } from "./runtime/cron/resolve-telegram-chat-id.ts";
import { resolveNativeCodingStartCwd } from "./runtime/native-tools/coding-target.ts";
import {
	createRuntimeNativeToolHost,
	type NativeToolAgentInfo,
	type NativeToolSessionListResult,
} from "./runtime/native-tools/runtime-host.ts";
import { createRestartRequiredWatcher } from "./runtime/notice/restart-required-watcher.ts";
import { nextSessionCursor } from "./runtime/persistence/session-cursor.ts";
import { SessionQuery } from "./runtime/persistence/session-query.ts";
import { SessionStore } from "./runtime/persistence/session-store/session-store.ts";
import { TelegramFileRefStore } from "./runtime/persistence/telegram-file-ref-store.ts";
import { TelegramRouteStore } from "./runtime/persistence/telegram-route-store.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";
import { spawnDaemonRestart } from "./runtime/process/restart-daemon.ts";
import { createSupervisor } from "./runtime/supervisor/create-supervisor.ts";

const layout = createOutclawLayout({ srcRoot: import.meta.dir });

mkdirSync(layout.homeDir, { recursive: true });

const config = loadGlobalConfig(layout.homeDir);
const discoveredAgents = discoverAgents(layout.homeDir);

const pidManager = new PidManager(layout.pidPath);
pidManager.write(process.pid);

if (discoveredAgents.length === 0) {
	throw new Error(
		"No agents configured. Run `oc start` to onboard the first agent.",
	);
}

const daemon = await startMultiAgentDaemon(config, discoveredAgents);

console.log(`outclaw runtime listening on ws://localhost:${daemon.port}`);
console.log(`runtime bound on http://${config.host}:${daemon.port}`);
console.log(`daemon pid: ${process.pid}`);
writeFileSync(layout.readyPath, `${process.pid}\n`);

let shuttingDown = false;

async function shutdown(reason: "SIGINT" | "SIGTERM") {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;

	console.log(`daemon shutdown requested (${reason})`);
	try {
		await daemon.stop();
		rmSync(layout.readyPath, { force: true });
		pidManager.remove();
		console.log(`daemon shutdown complete (${reason})`);
		process.exit(0);
	} catch (err) {
		console.error(`daemon shutdown failed (${reason}): ${extractError(err)}`);
		process.exit(1);
	}
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});

async function startMultiAgentDaemon(
	config: ReturnType<typeof loadGlobalConfig>,
	agents: ReturnType<typeof discoverAgents>,
) {
	const stateStore = new SessionStore(layout.dbPath, {
		agentId: agents[0]?.agentId,
	});
	stateStore.setFrontendNotice(undefined);
	const routeStore = new TelegramRouteStore(layout.dbPath);
	const agentStores = new Map(
		agents.map((agent) => [
			agent.agentId,
			new SessionStore(layout.dbPath, {
				agentId: agent.agentId,
			}),
		]),
	);
	const codingSharedSessionStore = new SessionStore(layout.dbPath, {
		agentId: CODING_STORAGE_OWNER_ID,
	});
	const codingSessions = new CodingSessionStore(layout.dbPath);
	const codingRepositories = new CodingRepositoryStore(layout.dbPath);
	const chatCodingLinks = new ChatCodingLinkStore(layout.dbPath);
	const codingEvents = new CodingSessionEventHub();
	// Shared Codex adapter for both Chat mode and Code mode. A local probe
	// against codex-cli 0.130.0 confirmed one app-server process can run
	// concurrent Codex threads for the same and different agent cwds without
	// cwd/config leakage. Each thread carries its own agent workspace cwd, so
	// the topology choice is just an adapter-process choice — sharing avoids
	// launching multiple app-server processes.
	const codexAdapter = new CodexAdapter();
	const piAdapter = new PiAdapter();
	const defaultPiChatModel = await piAdapter.getDefaultModel();
	if (!defaultPiChatModel) {
		throw new Error("Pi has no available model for default chat startup");
	}
	const codingFacade = codexAdapter;
	const codingService = createCodingService({
		facade: codingFacade,
		repositories: codingRepositories,
		sessions: codingSessions,
		events: codingEvents,
		sharedSessionStore: codingSharedSessionStore,
	});
	const transcriptReadersByAgent = new Map<
		string,
		| ((
				providerId: string,
				sessionId: string,
		  ) => Promise<
				Awaited<ReturnType<ClaudeAdapter["readTranscript"]>> | undefined
		  >)
		| undefined
	>();
	const chatProvidersByAgent = new Map<
		string,
		readonly BrowserChatProviderCatalog[]
	>();
	const workspaceMetadataByAgent = new Map<string, ProviderWorkspaceMetadata>();
	const nativeToolAgents: NativeToolAgentInfo[] = agents.map((agent) => ({
		agentId: agent.agentId,
		name: agent.name,
		homeDir: agent.homeDir,
		memoryRoot: agent.promptHomeDir,
	}));
	const runtimesById = new Map<string, AgentRuntime>();
	let guardedPeerAsk:
		| ((params: {
				fromAgentId: string;
				message: string;
				to: string;
		  }) => Promise<string>)
		| undefined;
	let broadcastChatCodingLinkChanged:
		| ((event: BrowserChatCodingLinksChangedEvent) => void)
		| undefined;
	const runtimes = agents.map((agent) => {
		const claudeAdapter = new ClaudeAdapter();
		claudeAdapter.prepareWorkspace(agent.promptHomeDir);
		// Materialize the Codex provider view of the agent workspace (skills
		// symlink + .codex/config.toml) so Codex Chat threads can load the
		// Outclaw-owned project layer once the workspace is trusted. The
		// trust step itself runs lazily inside CodexAdapter.run() before
		// the first Codex Chat thread for the workspace — that path is
		// async and the daemon entry is sync.
		codexAdapter.prepareWorkspace(agent.promptHomeDir);
		piAdapter.prepareWorkspace(agent.promptHomeDir);
		transcriptReadersByAgent.set(
			agent.agentId,
			async (providerId, sessionId) => {
				if (providerId === "claude") {
					return await claudeAdapter.readTranscript(sessionId);
				}
				if (providerId === "codex") {
					return await codexAdapter.readTranscript(sessionId);
				}
				if (providerId === "pi") {
					return await piAdapter.readTranscript(sessionId);
				}
				return undefined;
			},
		);
		chatProvidersByAgent.set(agent.agentId, [
			{
				providerId: "pi",
				displayName: "Pi",
				listModels: () => piAdapter.listScopedModels(),
			},
		]);
		const workspaceMetadata = collectProviderWorkspaceMetadata(
			agent.promptHomeDir,
			[piAdapter, claudeAdapter, codexAdapter],
		);
		workspaceMetadataByAgent.set(agent.agentId, workspaceMetadata);

		const runtime = createAgentRuntime({
			agentId: agent.agentId,
			autoTitle: config.autoTitle,
			cwd: agent.homeDir,
			cronDir: join(agent.homeDir, "cron"),
			defaultEffort: config.thinkingEffort,
			defaultModel: defaultPiChatModel,
			facade: piAdapter,
			providers: [{ providerId: "pi", displayName: "Pi", facade: piAdapter }],
			historyProviders: [
				{ providerId: "claude", displayName: "Claude", facade: claudeAdapter },
				{ providerId: "codex", displayName: "Codex", facade: codexAdapter },
			],
			workspaceIgnoredNames: workspaceMetadata.ignoredWorkspaceNames,
			defaultProviderId: "pi",
			getFrontendNotice: () => {
				const rolloverNotice = agentStores
					.get(agent.agentId)
					?.getRolloverNotice();
				if (rolloverNotice) {
					return rolloverNotice;
				}
				return stateStore.getFrontendNotice();
			},
			heartbeat: config.heartbeat,
			name: agent.name,
			nativeToolHostFactory: (context) =>
				createRuntimeNativeToolHost({
					agents: nativeToolAgents,
					coding: {
						list: ({ repository, includeArchived, limit }) =>
							listCodingForNativeTools({
								codingRepositories,
								codingSessions,
								...(repository === undefined ? {} : { repository }),
								...(includeArchived === undefined ? {} : { includeArchived }),
								...(limit === undefined ? {} : { limit }),
							}),
						cancel: async ({ providerId, sdkSessionId }) => {
							const result = codingService.runtime.cancelPrompt({
								providerId,
								sdkSessionId,
							});
							if (result.status === "accepted") {
								return true;
							}
							if (result.status === "already_terminal") {
								return false;
							}
							throw new Error(result.message);
						},
						readEvents: async ({ providerId, sdkSessionId }) => {
							const snapshot =
								codingEvents.snapshot?.({ providerId, sdkSessionId }) ?? [];
							if (snapshot.length > 0) {
								return snapshot.map((event) => ({ ...event }));
							}
							const events = await codingService.rehydrateSessionEvents({
								providerId,
								sdkSessionId,
							});
							return events.map((event) => ({ ...event }));
						},
						resolveSession: ({ providerId, sdkSessionId }) => {
							const session = codingSessions.getDetail(
								providerId,
								sdkSessionId,
							);
							return session
								? {
										providerId: session.providerId,
										sdkSessionId: session.sdkSessionId,
										runStatus: session.runStatus,
										title: session.title,
										cwd: session.cwd,
										...(session.repositoryId === undefined
											? {}
											: { repositoryId: session.repositoryId }),
										...(session.linkedChatSessionId === undefined
											? {}
											: {
													linkedChatSessionId: session.linkedChatSessionId,
												}),
										lastActive: session.lastActive,
										...(session.failureMessage === undefined
											? {}
											: { failureMessage: session.failureMessage }),
									}
								: undefined;
						},
						resume: async ({ providerId, sdkSessionId, prompt }) => {
							const result = await codingService.runtime.resumePrompt({
								providerId,
								sdkSessionId,
								prompt,
							});
							if (result.status !== "accepted") {
								throw new Error(result.message);
							}
							return {
								providerId: result.providerId,
								sdkSessionId: result.sdkSessionId,
								status: "accepted",
							};
						},
						start: async ({ target, prompt, cwd, linkedChatSession }) => {
							const result = await codingService.runtime.startPrompt({
								cwd: resolveNativeCodingStartCwd(codingRepositories, {
									target,
									...(cwd === undefined ? {} : { cwd }),
								}),
								prompt,
								...(linkedChatSession
									? { linkedChatSessionId: linkedChatSession.sdkSessionId }
									: {}),
							});
							if (result.status !== "accepted") {
								throw new Error(result.message);
							}
							if (linkedChatSession) {
								const event: BrowserChatCodingLinksChangedEvent = {
									type: "browser_chat_coding_links_changed",
									chatAgentId: linkedChatSession.agentId,
									chatProviderId: linkedChatSession.providerId,
									chatSdkSessionId: linkedChatSession.sdkSessionId,
									codingProviderId: result.providerId,
									codingSdkSessionId: result.sdkSessionId,
								};
								try {
									chatCodingLinks.upsert(event);
									broadcastChatCodingLinkChanged?.(event);
								} catch (error) {
									console.warn("Failed to link native coding session", error);
								}
							}
							return {
								providerId: result.providerId,
								sdkSessionId: result.sdkSessionId,
								status: "accepted",
							};
						},
					},
					context,
					cron: {
						listFailedRuns: ({ agentId, jobName, limit, sinceEpochMs }) =>
							listFailedCronRunsForNativeTools(layout.dbPath, {
								agentId: agentId ?? agent.agentId,
								...(jobName === undefined ? {} : { jobName }),
								...(limit === undefined ? {} : { limit }),
								...(sinceEpochMs === undefined ? {} : { sinceEpochMs }),
							}),
						runJob: ({ agentId, jobName }) => {
							const targetRuntime = runtimesById.get(agentId);
							if (!targetRuntime) {
								return {
									accepted: false,
									message: `Agent not found: ${agentId}`,
								};
							}
							const result = targetRuntime.runCronJob({ jobName });
							return {
								accepted: result.status === "accepted",
								...(result.status === "accepted"
									? {}
									: {
											message: `Cron job ${result.status}: ${result.jobName}`,
										}),
							};
						},
					},
					currentAgentId: agent.agentId,
					peers: {
						ask: async ({ fromAgentId, targetAgentName, message }) => {
							if (!guardedPeerAsk) {
								throw new Error("Peer ask is not configured");
							}
							return await guardedPeerAsk({
								fromAgentId,
								message,
								to: targetAgentName,
							});
						},
						send: ({ fromAgentId, fromAgentName, targetAgentId, message }) => {
							const targetRuntime = runtimesById.get(targetAgentId);
							return (
								targetRuntime?.sendFromAgent({
									fromAgentId,
									fromAgentName,
									message,
								}) ?? false
							);
						},
					},
					readTranscript: async ({ agentId, providerId, sdkSessionId }) =>
						await transcriptReadersByAgent.get(agentId)?.(
							providerId,
							sdkSessionId,
						),
					sessions: {
						getSession: ({ agentId, providerId, sdkSessionId, tag }) => {
							const row = agentStores
								.get(agentId)
								?.get(providerId, sdkSessionId);
							return row?.tag === tag
								? {
										agentId: row.agentId,
										providerId: row.providerId,
										sdkSessionId: row.sdkSessionId,
										title: row.title,
										tag,
										model: row.model,
										lastActive: row.lastActive,
									}
								: undefined;
						},
						listSessions: ({ agentId, cursor, limit, query, tag }) =>
							listSessionsForNativeTools(layout.dbPath, {
								...(agentId === undefined ? {} : { agentId }),
								...(cursor === undefined ? {} : { cursor }),
								...(limit === undefined ? {} : { limit }),
								...(query === undefined ? {} : { query }),
								tag,
							}),
					},
				}),
			promptHomeDir: agent.promptHomeDir,
			rollover: agent.config.rollover,
			resolveCronTelegramChatId: createCronTelegramChatIdResolver(
				agent.config.telegram,
			),
			restart: () => {
				spawnDaemonRestart(layout.cliEntry);
			},
			store: agentStores.get(agent.agentId),
			coding: codingService.runtime,
		});
		runtimesById.set(agent.agentId, runtime);
		return runtime;
	});
	const availableAgentsByBotUser = buildTelegramAgentIndex(agents);
	const supervisor = createSupervisor({
		agents: runtimes,
		browserApp: {
			distDir: layout.browserDistDir,
		},
		codingEvents,
		browserApi: createBrowserApi({
			agents: agents.map((agent) => {
				const runtime = runtimes.find(
					(candidate) => candidate.agentId === agent.agentId,
				);
				if (!runtime) {
					throw new Error(`Missing runtime for agent ${agent.agentId}`);
				}
				return {
					agentId: agent.agentId,
					name: agent.name,
					homeDir: agent.homeDir,
					providerId: runtime.providerId,
					terminalRunCommand: agent.config.terminal.runCommand,
				};
			}),
			chatCodingLinks,
			chatProvidersByAgent,
			coding: {
				startPrompt: codingService.runtime.startPrompt.bind(
					codingService.runtime,
				),
				resumePrompt: codingService.runtime.resumePrompt.bind(
					codingService.runtime,
				),
				stopPrompt: codingService.runtime.stopPrompt.bind(
					codingService.runtime,
				),
				cancelPrompt: codingService.runtime.cancelPrompt.bind(
					codingService.runtime,
				),
				archiveSession: (params) => codingService.archiveSession(params),
				listModels: () => codingService.listModels(),
				listSkills: (params) => codingService.listSkills(params),
				renameSession: (params) => codingService.renameSession(params),
				reconcileSessions: (params) => codingService.reconcileSessions(params),
				rehydrateSessionEvents: (params) =>
					codingService.rehydrateSessionEvents(params),
				restoreSession: (params) => codingService.restoreSession(params),
			},
			codingEvents,
			codingRepositories,
			codingSessions,
			filesRoot: layout.filesRoot,
			getBrowserClientAgentId: (clientId) =>
				stateStore.getBrowserClientAgentId(clientId),
			getRememberedAgentId: () => stateStore.getLastInteractiveAgentId(),
			gitRoot: layout.homeDir,
			homeDir: layout.homeDir,
			ignoredGitPaths: agents.flatMap((agent) =>
				(
					workspaceMetadataByAgent.get(agent.agentId)?.ignoredGitPaths ?? []
				).map((path) => relative(layout.homeDir, path).split(sep).join("/")),
			),
			readTranscriptsByAgent: transcriptReadersByAgent,
			storesByAgent: agentStores,
			workspaceIgnoredNamesByAgent: new Map(
				agents.map((agent) => [
					agent.agentId,
					workspaceMetadataByAgent.get(agent.agentId)?.ignoredWorkspaceNames ??
						[],
				]),
			),
		}),
		browserWatch: {
			agents: agents.map((agent) => ({
				agentId: agent.agentId,
				rootDir: agent.homeDir,
			})),
			gitRoot: layout.homeDir,
		},
		getBrowserClientAgentId: (clientId) =>
			stateStore.getBrowserClientAgentId(clientId),
		getDefaultAgentId: () => stateStore.getLastInteractiveAgentId(),
		hostname: config.host,
		port: config.port,
		rememberBrowserClientAgentId: (clientId, agentId) =>
			stateStore.setBrowserClientAgentId(clientId, agentId),
		rememberInteractiveAgentId: (agentId) =>
			stateStore.setLastInteractiveAgentId(agentId),
		telegramRouting: {
			getAgentId(botId, telegramUserId) {
				return routeStore.getAgentId(botId, telegramUserId);
			},
			listAgentIds(botId, telegramUserId) {
				return availableAgentsByBotUser(botId, telegramUserId);
			},
			rememberAgentId(botId, telegramUserId, agentId) {
				routeStore.setAgentId(botId, telegramUserId, agentId);
			},
		},
	});
	guardedPeerAsk = supervisor.askAgent;
	broadcastChatCodingLinkChanged =
		supervisor.broadcastBrowserChatCodingLinksChanged;
	const botManager = createTelegramBotManager({
		agents: agents.map((agent) => ({
			agentId: agent.agentId,
			allowedUsers: agent.config.telegram.allowedUsers,
			botToken: agent.config.telegram.botToken,
		})),
		createBotId: deriveTelegramBotId,
		createFileBindings: (botId) =>
			createTelegramFileBindings(layout.dbPath, botId, layout.filesRoot),
		filesRoot: layout.filesRoot,
		runtimeUrl: `ws://localhost:${supervisor.port}`,
	});

	for (const runtime of runtimes) {
		runtime.setCronResultHandler((params) =>
			botManager.sendCronResult(runtime.agentId, params),
		);
		runtime.setHeartbeatResultHandler((params) =>
			botManager.sendHeartbeatResult(runtime.agentId, params),
		);
		runtime.setRolloverNoticeHandler((params) =>
			botManager.sendRolloverNotice(runtime.agentId, params),
		);
	}

	const restartRequiredWatcher = createRestartRequiredWatcher({
		homeDir: layout.homeDir,
		onRestartRequired: () => {
			if (stateStore.getFrontendNotice()?.kind === "restart_required") {
				return;
			}
			stateStore.setFrontendNotice({ kind: "restart_required" });
			for (const runtime of runtimes) {
				runtime.broadcastRuntimeStatus();
			}
		},
	});
	restartRequiredWatcher.start();

	console.log(`agents: ${agents.map((agent) => agent.name).join(", ")}`);

	return {
		port: supervisor.port,
		async stop() {
			restartRequiredWatcher.stop();
			await supervisor.stop();
			botManager.stop();
			await codingService.stop();
			await codingFacade.dispose();
			await piAdapter.dispose();
			codingEvents.close();
			chatCodingLinks.close();
			codingSessions.close();
			codingSharedSessionStore.close();
			codingRepositories.close();
			for (const store of agentStores.values()) {
				store.close();
			}
			stateStore.close();
			routeStore.close();
		},
	};
}

function listSessionsForNativeTools(
	dbPath: string,
	options: {
		agentId?: string;
		cursor?: string;
		limit?: number;
		query?: string;
		tag: "chat" | "cron";
	},
): NativeToolSessionListResult | NativeToolResult<NativeToolSessionListResult> {
	const limit = options.limit ?? 20;
	const cursorResult: NativeToolResult<SessionCursor | undefined> =
		options.cursor === undefined
			? { ok: true, data: undefined }
			: decodeNativeSessionCursor(options.cursor);
	if (!cursorResult.ok) {
		return cursorResult;
	}
	const cursor = cursorResult.data;
	const query = new SessionQuery(dbPath);
	try {
		if (options.query) {
			const matches = query.search({
				...(options.agentId === undefined ? {} : { agentId: options.agentId }),
				...(cursor === undefined ? {} : { cursor }),
				limit,
				query: options.query,
				tag: options.tag,
			});
			return {
				sessions: matches.map((match) => ({
					agentId: match.session.agentId,
					providerId: match.session.providerId,
					sdkSessionId: match.session.sdkSessionId,
					title: match.session.title,
					tag: options.tag,
					model: match.session.model,
					lastActive: match.session.lastActive,
					matches: match.turns.map((turn) => ({
						role: turn.role,
						content: turn.bodyText,
						timestamp: turn.timestamp,
					})),
				})),
				...formatNativeNextCursor(
					nextSessionCursor(
						matches.map((match) => match.session),
						limit,
					),
				),
			};
		}

		const rows = query.list({
			...(options.agentId === undefined ? {} : { agentId: options.agentId }),
			...(cursor === undefined ? {} : { cursor }),
			limit,
			tag: options.tag,
		});
		return {
			sessions: rows.map((row) => ({
				agentId: row.agentId,
				providerId: row.providerId,
				sdkSessionId: row.sdkSessionId,
				title: row.title,
				tag: options.tag,
				model: row.model,
				lastActive: row.lastActive,
			})),
			...formatNativeNextCursor(nextSessionCursor(rows, limit)),
		};
	} finally {
		query.close();
	}
}

function encodeNativeSessionCursor(cursor: SessionCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeNativeSessionCursor(
	cursor: string,
): NativeToolResult<SessionCursor> {
	try {
		const parsed = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		) as unknown;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			typeof (parsed as { lastActive?: unknown }).lastActive !== "number" ||
			typeof (parsed as { sdkSessionId?: unknown }).sdkSessionId !== "string"
		) {
			return nativeValidationError("Invalid native session cursor");
		}
		return {
			ok: true,
			data: {
				lastActive: (parsed as { lastActive: number }).lastActive,
				...(typeof (parsed as { providerId?: unknown }).providerId === "string"
					? { providerId: (parsed as { providerId: string }).providerId }
					: {}),
				sdkSessionId: (parsed as { sdkSessionId: string }).sdkSessionId,
			},
		};
	} catch {
		return nativeValidationError("Invalid native session cursor");
	}
}

function nativeValidationError<T>(message: string): NativeToolResult<T> {
	return {
		ok: false,
		error: {
			code: "validation_error",
			message,
		},
	};
}

function formatNativeNextCursor(cursor: SessionCursor | undefined): {
	nextCursor?: string;
} {
	return cursor === undefined
		? {}
		: { nextCursor: encodeNativeSessionCursor(cursor) };
}

function listCodingForNativeTools(options: {
	codingRepositories: CodingRepositoryStore;
	codingSessions: CodingSessionStore;
	repository?: string;
	includeArchived?: boolean;
	limit?: number;
}) {
	const allRepositories = options.codingRepositories.list({
		includeArchived: options.includeArchived,
	});
	const repository = resolveCodingRepositoryForNativeTools(
		options.repository,
		allRepositories,
	);
	const repositories =
		repository === undefined
			? allRepositories
			: allRepositories.filter((candidate) => candidate.id === repository.id);
	const sessionPages = [
		options.codingSessions.list({
			limit: options.limit,
			...(repository === undefined ? {} : { repositoryId: repository.id }),
		}),
		...(options.includeArchived
			? [
					options.codingSessions.list({
						lifecycleStatus: "archived",
						limit: options.limit,
						...(repository === undefined
							? {}
							: { repositoryId: repository.id }),
					}),
				]
			: []),
	];
	const limit = options.limit ?? 20;
	return {
		repositories,
		sessions: sessionPages
			.flatMap((page) => page.sessions)
			.sort((left, right) => right.lastActive - left.lastActive)
			.slice(0, limit)
			.map((session) => ({
				providerId: session.providerId,
				sdkSessionId: session.sdkSessionId,
				runStatus: session.runStatus,
				title: session.title,
				cwd: session.cwd,
				...(session.repositoryId === undefined
					? {}
					: { repositoryId: session.repositoryId }),
				...(session.linkedChatSessionId === undefined
					? {}
					: { linkedChatSessionId: session.linkedChatSessionId }),
				lastActive: session.lastActive,
				...(session.failureMessage === undefined
					? {}
					: { failureMessage: session.failureMessage }),
			})),
	};
}

function resolveCodingRepositoryForNativeTools(
	value: string | undefined,
	repositories: ReturnType<CodingRepositoryStore["list"]>,
) {
	if (value === undefined) {
		return undefined;
	}
	const byId = repositories.find((repository) => repository.id === value);
	if (byId) {
		return byId;
	}
	const absolute = resolve(value);
	const byPath = repositories.find(
		(repository) => resolve(repository.rootCwd) === absolute,
	);
	if (byPath) {
		return byPath;
	}
	throw new Error(`Unknown coding repository: ${value}`);
}

function listFailedCronRunsForNativeTools(
	dbPath: string,
	options: {
		agentId: string;
		jobName?: string;
		limit?: number;
		sinceEpochMs?: number;
	},
) {
	const query = new SessionQuery(dbPath);
	try {
		return query
			.listFailedCronRuns({
				agentId: options.agentId,
				...(options.jobName === undefined ? {} : { jobName: options.jobName }),
				...(options.limit === undefined ? {} : { limit: options.limit }),
				...(options.sinceEpochMs === undefined
					? {}
					: { since: options.sinceEpochMs }),
			})
			.map((row) => ({
				jobName: row.title,
				sessionRef: `${row.providerId}/${row.sdkSessionId}`,
				startedAt: row.failedAt ?? row.lastActive,
				error: row.failureMessage ?? "cron run failed",
			}));
	} finally {
		query.close();
	}
}

function collectProviderWorkspaceMetadata(
	promptHomeDir: string,
	providers: readonly Facade[],
): Required<ProviderWorkspaceMetadata> {
	const metadata = providers.map(
		(provider) =>
			provider.workspaceMetadata?.(promptHomeDir) ?? {
				ignoredGitPaths: [],
				ignoredWorkspaceNames: [],
			},
	);
	return {
		ignoredGitPaths: [
			...new Set(metadata.flatMap((entry) => entry.ignoredGitPaths ?? [])),
		],
		ignoredWorkspaceNames: [
			...new Set(
				metadata.flatMap((entry) => entry.ignoredWorkspaceNames ?? []),
			),
		],
	};
}

function buildTelegramAgentIndex(agents: ReturnType<typeof discoverAgents>) {
	return (botId: string, telegramUserId: number) =>
		agents
			.filter((agent) => {
				const token = agent.config.telegram.botToken;
				return (
					token !== "" &&
					deriveTelegramBotId(token) === botId &&
					agent.config.telegram.allowedUsers.includes(telegramUserId)
				);
			})
			.map((agent) => agent.agentId);
}

function createTelegramFileBindings(
	path: string,
	botId: string,
	storageRoot: string,
) {
	const store = new TelegramFileRefStore(path, { botId });

	return {
		close() {
			store.close();
		},
		async rememberMessageFile({
			chatId,
			messageId,
			file,
			direction,
		}: TelegramMessageFileRecord) {
			const storedPath =
				direction === "outbound" && file.kind === "image"
					? (await copyTelegramFile(storageRoot, file.image.path)).path
					: file.kind === "image"
						? file.image.path
						: file.kind === "voice"
							? file.voice.path
							: file.document.path;
			store.upsert({
				chatId,
				messageId,
				path: storedPath,
				file:
					file.kind === "image"
						? {
								kind: "image" as const,
								image: {
									path: storedPath,
									mediaType: file.image.mediaType,
								},
							}
						: file.kind === "voice"
							? {
									kind: "voice" as const,
									voice: {
										path: storedPath,
										mimeType: file.voice.mimeType,
										durationSeconds: file.voice.durationSeconds,
									},
								}
							: {
									kind: "document" as const,
									document: {
										path: storedPath,
										displayName: file.document.displayName,
									},
								},
				direction,
			});
		},
		async resolveMessageFile(chatId: number, messageId: number) {
			const record = store.get(chatId, messageId);
			if (!record || !existsSync(record.path)) {
				return undefined;
			}
			if (record.kind === "image" && record.mediaType) {
				return {
					kind: "image" as const,
					image: {
						path: record.path,
						mediaType: record.mediaType as ImageMediaType,
					},
				};
			}
			if (record.kind === "voice") {
				return {
					kind: "voice" as const,
					voice: {
						path: record.path,
						mimeType:
							typeof record.mediaType === "string"
								? record.mediaType
								: undefined,
						durationSeconds: record.durationSeconds,
					},
				};
			}
			if (record.kind === "document") {
				return {
					kind: "document" as const,
					document: {
						path: record.path,
						displayName: record.displayName ?? basename(record.path),
					},
				};
			}
			return undefined;
		},
		store,
	};
}
