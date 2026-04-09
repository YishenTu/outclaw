import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startTelegramBot } from "./frontend/telegram/index.ts";
import { copyTelegramMedia } from "./frontend/telegram/media.ts";
import { loadConfig } from "./runtime/config.ts";
import { SessionStore } from "./runtime/persistence/session-store.ts";
import { TelegramMediaRefStore } from "./runtime/persistence/telegram-media-ref-store.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";
import { seedTemplates } from "./runtime/prompt/seed-templates.ts";
import { createRuntime } from "./runtime/transport/ws-server.ts";

const HOME_DIR = join(homedir(), ".outclaw");
mkdirSync(HOME_DIR, { recursive: true });
seedTemplates(HOME_DIR, join(import.meta.dir, "templates"));

const config = loadConfig(HOME_DIR);

const pidManager = new PidManager(join(HOME_DIR, "daemon.pid"));
pidManager.write(process.pid);

const dbPath = join(HOME_DIR, "db.sqlite");
const mediaRoot = join(HOME_DIR, "media");
const store = new SessionStore(dbPath);
const telegramMediaRefStore = new TelegramMediaRefStore(dbPath);

const runtime = createRuntime({
	port: config.port,
	cwd: HOME_DIR,
	cronDir: join(HOME_DIR, "cron"),
	heartbeat: config.heartbeat,
	promptHomeDir: HOME_DIR,
	permissionMode: config.permissionMode,
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
			mediaRoot,
			resolveMessageImage: async (chatId, messageId) => {
				const record = telegramMediaRefStore.get(chatId, messageId);
				if (!record || !existsSync(record.path)) return undefined;
				return {
					path: record.path,
					mediaType: record.mediaType,
				};
			},
			rememberMessageImage: async ({ chatId, messageId, image, direction }) => {
				const storedImage =
					direction === "outbound"
						? await copyTelegramMedia(mediaRoot, image.path, image.mediaType)
						: image;
				telegramMediaRefStore.upsert({
					chatId,
					messageId,
					path: storedImage.path,
					mediaType: storedImage.mediaType,
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
	telegramMediaRefStore.close();
	pidManager.remove();
	process.exit(0);
}

process.on("SIGINT", () => {
	void shutdown();
});
process.on("SIGTERM", () => {
	void shutdown();
});
