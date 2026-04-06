import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { startTelegramBot } from "./frontend/telegram/index.ts";
import { PidManager } from "./runtime/pid.ts";
import { createRuntime } from "./runtime/server.ts";

const HOME_DIR = join(homedir(), ".misanthropic");
mkdirSync(HOME_DIR, { recursive: true });

const pidManager = new PidManager(join(HOME_DIR, "daemon.pid"));
pidManager.write(process.pid);

const PORT = Number(process.env.PORT ?? 4000);

const runtime = createRuntime({ port: PORT, cwd: HOME_DIR });
console.log(`misanthropic runtime listening on ws://localhost:${runtime.port}`);
console.log(`agent cwd: ${HOME_DIR}`);
console.log(`daemon pid: ${process.pid}`);

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
let telegram: ReturnType<typeof startTelegramBot> | undefined;

if (telegramToken) {
	telegram = startTelegramBot({
		token: telegramToken,
		runtimeUrl: `ws://localhost:${runtime.port}`,
	});
} else {
	console.log("TELEGRAM_BOT_TOKEN not set, skipping Telegram");
}

function shutdown() {
	telegram?.stop();
	runtime.stop();
	pidManager.remove();
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
