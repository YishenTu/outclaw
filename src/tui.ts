import { homedir } from "node:os";
import { join } from "node:path";
import { startTui } from "./frontend/tui/index.tsx";
import { loadGlobalConfig } from "./runtime/config.ts";

const config = loadGlobalConfig(join(homedir(), ".outclaw"));
const url = `ws://localhost:${config.port}`;
const agentFlagIndex = process.argv.indexOf("--agent");
const agentName =
	agentFlagIndex !== -1 ? process.argv[agentFlagIndex + 1] : undefined;

startTui(url, { agentName });
