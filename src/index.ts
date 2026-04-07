import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startTelegramBot } from "./frontend/telegram/index.ts";
import { SessionStore } from "./runtime/persistence/session-store.ts";
import { PidManager } from "./runtime/process/pid-manager.ts";
import { seedTemplates } from "./runtime/prompt/seed-templates.ts";
import { createRuntime } from "./runtime/transport/ws-server.ts";

const HOME_DIR = join(homedir(), ".misanthropic");
mkdirSync(HOME_DIR, { recursive: true });
seedTemplates(HOME_DIR, join(import.meta.dir, "..", "templates"));

const pidManager = new PidManager(join(HOME_DIR, "daemon.pid"));
pidManager.write(process.pid);

const store = new SessionStore(join(HOME_DIR, "db.sqlite"));
const PORT = Number(process.env.PORT ?? 4000);

const runtime = createRuntime({
	port: PORT,
	cwd: HOME_DIR,
	promptHomeDir: HOME_DIR,
	store,
});
console.log(`misanthropic runtime listening on ws://localhost:${runtime.port}`);
console.log(`agent cwd: ${HOME_DIR}`);
console.log(`daemon pid: ${process.pid}`);

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS?.split(",")
	.map(Number)
	.filter(Boolean);
let telegram: ReturnType<typeof startTelegramBot> | undefined;

if (telegramToken) {
	if (!allowedUsers || allowedUsers.length === 0) {
		console.error(
			"TELEGRAM_BOT_TOKEN is set but TELEGRAM_ALLOWED_USERS is missing or empty. " +
				"Set TELEGRAM_ALLOWED_USERS to a comma-separated list of Telegram user IDs.",
		);
		process.exit(1);
	}
	telegram = startTelegramBot({
		token: telegramToken,
		runtimeUrl: `ws://localhost:${runtime.port}`,
		allowedUsers,
	});
} else {
	console.log("TELEGRAM_BOT_TOKEN not set, skipping Telegram");
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
