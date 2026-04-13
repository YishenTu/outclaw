import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ClaudeAdapter } from "./backend/adapters/claude.ts";
import { ensureClaudeSkillsSymlink } from "./backend/adapters/claude-setup.ts";
import { copyTelegramFile } from "./frontend/telegram/files/storage.ts";
import { startTelegramBot } from "./frontend/telegram/index.ts";
import { loadConfig } from "./runtime/config.ts";
import { migrateLegacyTelegramFilesRoot } from "./runtime/persistence/migrate-telegram-files-root.ts";
import { SessionStore } from "./runtime/persistence/session-store.ts";
import { TelegramFileRefStore } from "./runtime/persistence/telegram-file-ref-store.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";
import { spawnDaemonRestart } from "./runtime/process/restart-daemon.ts";
import { seedTemplates } from "./runtime/prompt/seed-templates.ts";
import { createRuntime } from "./runtime/transport/ws-server.ts";

const HOME_DIR = join(homedir(), ".outclaw");
mkdirSync(HOME_DIR, { recursive: true });
seedTemplates(HOME_DIR, join(import.meta.dir, "templates"));
ensureClaudeSkillsSymlink(HOME_DIR);

const config = loadConfig(HOME_DIR);

const pidManager = new PidManager(join(HOME_DIR, "daemon.pid"));
pidManager.write(process.pid);

const dbPath = join(HOME_DIR, "db.sqlite");
const legacyMediaRoot = join(HOME_DIR, "media");
const filesRoot = join(HOME_DIR, "files");
const store = new SessionStore(dbPath, { legacyProviderId: "claude" });
const telegramFileRefStore = new TelegramFileRefStore(dbPath);
const migrateTelegramFilesRoot = () =>
	migrateLegacyTelegramFilesRoot({
		legacyRoot: legacyMediaRoot,
		filesRoot,
		store: telegramFileRefStore,
	});
migrateTelegramFilesRoot();

const CLI_ENTRY = join(import.meta.dir, "cli.ts");

const runtime = createRuntime({
	port: config.port,
	facade: new ClaudeAdapter({ autoCompact: config.autoCompact }),
	cwd: HOME_DIR,
	cronDir: join(HOME_DIR, "cron"),
	heartbeat: config.heartbeat,
	promptHomeDir: HOME_DIR,
	restart: () => {
		spawnDaemonRestart(CLI_ENTRY);
	},
	store,
});
console.log(`outclaw runtime listening on ws://localhost:${runtime.port}`);
console.log(`agent cwd: ${HOME_DIR}`);
console.log(`daemon pid: ${process.pid}`);

let telegram: ReturnType<typeof startTelegramBot> | undefined;

if (config.telegram.botToken) {
	if (config.telegram.allowedUsers.length === 0) {
		console.warn(
			"WARNING: telegram.botToken is set but telegram.allowedUsers is empty. " +
				"Telegram bot will not start. Add allowed user IDs to ~/.outclaw/config.json.",
		);
	} else {
		telegram = startTelegramBot({
			token: config.telegram.botToken,
			runtimeUrl: `ws://localhost:${runtime.port}`,
			allowedUsers: config.telegram.allowedUsers,
			filesRoot,
			resolveMessageFile: async (chatId, messageId) => {
				const record = telegramFileRefStore.get(chatId, messageId);
				if (!record || !existsSync(record.path)) return undefined;
				if (record.kind === "image" && record.mediaType) {
					return {
						kind: "image",
						image: {
							path: record.path,
							mediaType: record.mediaType,
						},
					};
				}
				if (record.kind === "document") {
					return {
						kind: "document",
						document: {
							path: record.path,
							displayName: record.displayName ?? basename(record.path),
						},
					};
				}
				return undefined;
			},
			rememberMessageFile: async ({ chatId, messageId, file, direction }) => {
				const storedPath =
					direction === "outbound" && file.kind === "image"
						? (await copyTelegramFile(filesRoot, file.image.path)).path
						: file.kind === "image"
							? file.image.path
							: file.document.path;
				telegramFileRefStore.upsert({
					chatId,
					messageId,
					path: storedPath,
					file:
						file.kind === "image"
							? {
									kind: "image",
									image: {
										path: storedPath,
										mediaType: file.image.mediaType,
									},
								}
							: {
									kind: "document",
									document: {
										path: storedPath,
										displayName: file.document.displayName,
									},
								},
					direction,
				});
			},
		});
		runtime.setHeartbeatResultHandler((params) =>
			telegram?.sendHeartbeatResult(params),
		);
		runtime.setCronResultHandler((params) => telegram?.sendCronResult(params));
	}
} else {
	console.log("Telegram not configured, skipping");
}

let shuttingDown = false;

async function shutdown() {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;

	await runtime.stop();
	telegram?.stop();
	store.close();
	telegramFileRefStore.close();
	pidManager.remove();
	process.exit(0);
}

process.on("SIGINT", () => {
	void shutdown();
});
process.on("SIGTERM", () => {
	void shutdown();
});
