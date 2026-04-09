import { homedir } from "node:os";
import { join } from "node:path";
import { startTui } from "./frontend/tui.tsx";
import { loadConfig } from "./runtime/config.ts";

const config = loadConfig(join(homedir(), ".outclaw"));
const url = `ws://localhost:${config.port}`;

startTui(url);
