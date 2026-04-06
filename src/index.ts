import { createRuntime } from "./runtime/server.ts";

const PORT = Number(process.env.PORT ?? 4000);

const runtime = createRuntime({ port: PORT });

console.log(`misanthropic runtime listening on ws://localhost:${runtime.port}`);

process.on("SIGINT", () => {
	runtime.stop();
	process.exit(0);
});
