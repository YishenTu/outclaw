import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { ClaudeAdapter } from "./backend/adapters/claude.ts";
import { prepareAgentWorkspace } from "./backend/agent-workspace.ts";
import type { ImageMediaType } from "./common/protocol.ts";
import { deriveTelegramBotId } from "./common/telegram.ts";
import type { TelegramMessageFileRecord } from "./frontend/telegram/files/message-file-ref.ts";
import { copyTelegramFile } from "./frontend/telegram/files/storage.ts";
import { createTelegramBotManager } from "./frontend/telegram/index.ts";
import { discoverAgents } from "./runtime/agents/discover-agents.ts";
import { createAgentRuntime } from "./runtime/application/create-agent-runtime.ts";
import { createBrowserApi } from "./runtime/browser/create-browser-api.ts";
import { loadGlobalConfig } from "./runtime/config.ts";
import { createCronTelegramChatIdResolver } from "./runtime/cron/resolve-telegram-chat-id.ts";
import { createRestartRequiredWatcher } from "./runtime/notice/restart-required-watcher.ts";
import { SessionStore } from "./runtime/persistence/session-store.ts";
import { TelegramFileRefStore } from "./runtime/persistence/telegram-file-ref-store.ts";
import { TelegramRouteStore } from "./runtime/persistence/telegram-route-store.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";
import { spawnDaemonRestart } from "./runtime/process/restart-daemon.ts";
import { createSupervisor } from "./runtime/supervisor/create-supervisor.ts";

const HOME_DIR = join(homedir(), ".outclaw");
const CLI_ENTRY = join(import.meta.dir, "cli.ts");
const BROWSER_DIST_DIR = join(import.meta.dir, "frontend", "browser", "dist");
const dbPath = join(HOME_DIR, "db.sqlite");
const filesRoot = join(HOME_DIR, "files");
const readyPath = join(HOME_DIR, "daemon.ready");

mkdirSync(HOME_DIR, { recursive: true });

const config = loadGlobalConfig(HOME_DIR);
const discoveredAgents = discoverAgents(HOME_DIR);

const pidManager = new PidManager(join(HOME_DIR, "daemon.pid"));
pidManager.write(process.pid);

if (discoveredAgents.length === 0) {
	throw new Error(
		"No agents configured. Run `oc start` to onboard the first agent.",
	);
}

const daemon = startMultiAgentDaemon(config, discoveredAgents);

console.log(`outclaw runtime listening on ws://localhost:${daemon.port}`);
console.log(`runtime bound on http://${config.host}:${daemon.port}`);
console.log(`daemon pid: ${process.pid}`);
writeFileSync(readyPath, `${process.pid}\n`);

let shuttingDown = false;

async function shutdown() {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;

	await daemon.stop();
	rmSync(readyPath, { force: true });
	pidManager.remove();
	process.exit(0);
}

process.on("SIGINT", () => {
	void shutdown();
});
process.on("SIGTERM", () => {
	void shutdown();
});

function startMultiAgentDaemon(
	config: ReturnType<typeof loadGlobalConfig>,
	agents: ReturnType<typeof discoverAgents>,
) {
	for (const agent of agents) {
		prepareAgentWorkspace(agent.promptHomeDir);
	}

	const stateStore = new SessionStore(dbPath, {
		agentId: agents[0]?.agentId,
	});
	stateStore.setFrontendNotice(undefined);
	const routeStore = new TelegramRouteStore(dbPath);
	const agentStores = new Map(
		agents.map((agent) => [
			agent.agentId,
			new SessionStore(dbPath, {
				agentId: agent.agentId,
			}),
		]),
	);
	const runtimes = agents.map((agent) =>
		createAgentRuntime({
			agentId: agent.agentId,
			cwd: agent.homeDir,
			cronDir: join(agent.homeDir, "cron"),
			facade: new ClaudeAdapter({ autoCompact: config.autoCompact }),
			getFrontendNotice: () => {
				const rolloverNotice = agentStores
					.get(agent.agentId)
					?.getRolloverNotice();
				if (rolloverNotice) {
					return {
						kind: "rollover",
						message: rolloverNotice,
					} as const;
				}
				return stateStore.getFrontendNotice();
			},
			heartbeat: config.heartbeat,
			name: agent.name,
			promptHomeDir: agent.promptHomeDir,
			rollover: agent.config.rollover,
			resolveCronTelegramChatId: createCronTelegramChatIdResolver(
				agent.config.telegram,
			),
			restart: () => {
				spawnDaemonRestart(CLI_ENTRY);
			},
			store: agentStores.get(agent.agentId),
		}),
	);
	const availableAgentsByBotUser = buildTelegramAgentIndex(agents);
	const supervisor = createSupervisor({
		agents: runtimes,
		browserApp: {
			distDir: BROWSER_DIST_DIR,
		},
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
				};
			}),
			getRememberedAgentId: () => stateStore.getLastInteractiveAgentId(),
			gitRoot: HOME_DIR,
			homeDir: HOME_DIR,
			ignoredGitPaths: agents.map((agent) =>
				relative(HOME_DIR, join(agent.promptHomeDir, ".claude", "skills"))
					.split(sep)
					.join("/"),
			),
			storesByAgent: agentStores,
		}),
		browserWatch: {
			agents: agents.map((agent) => ({
				agentId: agent.agentId,
				rootDir: agent.homeDir,
			})),
			gitRoot: HOME_DIR,
		},
		getDefaultAgentId: () => stateStore.getLastInteractiveAgentId(),
		hostname: config.host,
		port: config.port,
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
	const botManager = createTelegramBotManager({
		agents: agents.map((agent) => ({
			agentId: agent.agentId,
			allowedUsers: agent.config.telegram.allowedUsers,
			botToken: agent.config.telegram.botToken,
		})),
		createBotId: deriveTelegramBotId,
		createFileBindings: (botId) =>
			createTelegramFileBindings(dbPath, botId, filesRoot),
		filesRoot,
		runtimeUrl: `ws://localhost:${supervisor.port}`,
	});

	for (const runtime of runtimes) {
		runtime.setCronResultHandler((params) =>
			botManager.sendCronResult(runtime.agentId, params),
		);
		runtime.setHeartbeatResultHandler((params) =>
			botManager.sendHeartbeatResult(runtime.agentId, params),
		);
	}

	const restartRequiredWatcher = createRestartRequiredWatcher({
		homeDir: HOME_DIR,
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
			for (const store of agentStores.values()) {
				store.close();
			}
			stateStore.close();
			routeStore.close();
		},
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
