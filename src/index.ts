import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startTelegramBot } from "./frontend/telegram/index.ts";
import { loadConfig } from "./runtime/config.ts";
import { SessionStore } from "./runtime/persistence/session-store.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";
import { seedTemplates } from "./runtime/prompt/seed-templates.ts";
import { createRuntime } from "./runtime/transport/ws-server.ts";

const HOME_DIR = join(homedir(), ".misanthropic");
mkdirSync(HOME_DIR, { recursive: true });
seedTemplates(HOME_DIR, join(import.meta.dir, "..", "templates"));

const config = loadConfig(HOME_DIR);

const pidManager = new PidManager(join(HOME_DIR, "daemon.pid"));
pidManager.write(process.pid);

const store = new SessionStore(join(HOME_DIR, "db.sqlite"));

const runtime = createRuntime({
	port: config.port,
	cwd: HOME_DIR,
	promptHomeDir: HOME_DIR,
	permissionMode: config.permissionMode,
	store,
});
console.log(`misanthropic runtime listening on ws://localhost:${runtime.port}`);
console.log(`agent cwd: ${HOME_DIR}`);
console.log(`daemon pid: ${process.pid}`);

let telegram: ReturnType<typeof startTelegramBot> | undefined;

if (config.telegram.botToken) {
	if (config.telegram.allowedUsers.length === 0) {
		console.warn(
			"WARNING: telegram.botToken is set but telegram.allowedUsers is empty. " +
				"Telegram bot will not start. Add allowed user IDs to ~/.misanthropic/config.json.",
		);
	} else {
		telegram = startTelegramBot({
			token: config.telegram.botToken,
			runtimeUrl: `ws://localhost:${runtime.port}`,
			allowedUsers: config.telegram.allowedUsers,
		});
	}
} else {
	console.log("Telegram not configured, skipping");
}

function shutdown() {
	telegram?.stop();
	runtime.stop();
	store.close();
	pidManager.remove();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
