import { startTelegramBot } from "./frontend/telegram.ts";
import { createRuntime } from "./runtime/server.ts";

const PORT = Number(process.env.PORT ?? 4000);

const runtime = createRuntime({ port: PORT });
console.log(`misanthropic runtime listening on ws://localhost:${runtime.port}`);

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

process.on("SIGINT", () => {
	telegram?.stop();
	runtime.stop();
	process.exit(0);
});
