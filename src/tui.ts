import { createOutclawLayout } from "./common/layout.ts";
import { startTui } from "./frontend/tui/index.tsx";
import { loadGlobalConfig } from "./runtime/config.ts";

const layout = createOutclawLayout({ srcRoot: import.meta.dir });
const config = loadGlobalConfig(layout.homeDir);
const url = `ws://localhost:${config.port}`;
const agentFlagIndex = process.argv.indexOf("--agent");
const agentName =
	agentFlagIndex !== -1 ? process.argv[agentFlagIndex + 1] : undefined;

startTui(url, { agentName });
