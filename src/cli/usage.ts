function joinLines(lines: string[]) {
	return lines.join("\n");
}

export function isHelpFlag(value: string | undefined): boolean {
	return value === "-h" || value === "--help";
}

export function hasHelpFlag(values: string[]): boolean {
	return values.some((value) => isHelpFlag(value));
}

export function formatUsage() {
	return joinLines([
		"Usage: oc <start|stop|restart|status|tui|browser|dev|build|agent|config|session>",
		"       oc start|restart [--lan] [--host HOST]",
		"       oc agent <list|create|config|rename|remove|ask|name>",
		"       oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N]",
		"       oc config secure",
		"       oc session list [--limit N] [--tag cron]",
		"       oc session search <query> [--limit N]",
		"       oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
		"",
		"Quick start:",
		"       first run:   oc build && oc start",
		"       command help: oc <command> -h",
	]);
}

export function printUsage() {
	console.log(formatUsage());
}

export function formatStartUsage() {
	return joinLines([
		"Usage: oc start [--lan] [--host HOST]",
		"       oc restart [--lan] [--host HOST]",
		"",
		"Start or restart the daemon in the background.",
		"Default host: 127.0.0.1 (browser UI stays on this machine).",
		"Use --lan to save 0.0.0.0 so other devices on the LAN can open the browser UI.",
		"Use --host HOST to save a specific bind host in config.json before launch.",
		"If browser source changed, rebuild first: oc build && oc restart",
		"",
		"Examples:",
		"       oc start",
		"       oc start --lan",
		"       oc restart --host 127.0.0.1",
	]);
}

export function printStartUsage() {
	console.log(formatStartUsage());
}

export function formatAgentUsage() {
	return joinLines([
		"Usage: oc agent <list|create|config|rename|remove|ask|name>",
		"       oc agent create <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]",
		"       oc agent config <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]",
		"       oc agent rename <old-name> <new-name>",
		"       oc agent remove <name>",
		'       oc agent ask --to <target> [--timeout <seconds>] "<message>"',
		"",
		"Commands:",
		"       list      list configured agents",
		"       create    create an agent workspace and config",
		"       config    update telegram settings for an agent",
		"       rename    rename an agent",
		"       remove    remove an agent",
		"       ask       send a message from the current agent workspace",
		"       <name>    open TUI attached to that agent",
	]);
}

export function printAgentUsage() {
	console.log(formatAgentUsage());
}

export function formatAgentListUsage() {
	return joinLines([
		"Usage: oc agent list",
		"",
		"Lists configured agents by name.",
	]);
}

export function printAgentListUsage() {
	console.log(formatAgentListUsage());
}

export function formatAgentCreateUsage() {
	return joinLines([
		"Usage: oc agent create <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]",
		"",
		"Creates an agent workspace under ~/.outclaw/agents/<name> and registers it in config.json.",
	]);
}

export function printAgentCreateUsage() {
	console.log(formatAgentCreateUsage());
}

export function formatAgentConfigUsage() {
	return joinLines([
		"Usage: oc agent config <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]",
		"",
		"Updates telegram settings for an existing agent. Omitted flags are preserved.",
	]);
}

export function printAgentConfigUsage() {
	console.log(formatAgentConfigUsage());
}

export function formatAgentRenameUsage() {
	return joinLines([
		"Usage: oc agent rename <old-name> <new-name>",
		"",
		"Renames an existing agent workspace and keeps its agent id.",
	]);
}

export function printAgentRenameUsage() {
	console.log(formatAgentRenameUsage());
}

export function formatAgentRemoveUsage() {
	return joinLines([
		"Usage: oc agent remove <name>",
		"",
		"Removes an agent workspace and its config registration.",
	]);
}

export function printAgentRemoveUsage() {
	console.log(formatAgentRemoveUsage());
}

export function formatAgentAskUsage() {
	return joinLines([
		'Usage: oc agent ask --to <target> [--timeout <seconds>] "<message>"',
		"",
		"Send a message from the current agent workspace to another agent.",
		"Run this inside an agent workspace so the sender can be resolved from cwd.",
	]);
}

export function printAgentAskUsage() {
	console.log(formatAgentAskUsage());
}

export function formatConfigUsage() {
	return joinLines([
		"Usage: oc config <runtime|secure>",
		"       oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N]",
		"       oc config secure",
		"",
		"Commands:",
		"       runtime   update shared runtime settings saved in config.json",
		"       secure    move hardcoded telegram config into ~/.outclaw/.env",
	]);
}

export function printConfigUsage() {
	console.log(formatConfigUsage());
}

export function formatConfigRuntimeUsage() {
	return joinLines([
		"Usage: oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N]",
		"",
		"Updates shared runtime settings saved in config.json.",
		"Use --host 0.0.0.0 for trusted LAN browser access.",
	]);
}

export function printConfigRuntimeUsage() {
	console.log(formatConfigRuntimeUsage());
}

export function formatConfigSecureUsage() {
	return joinLines([
		"Usage: oc config secure",
		"",
		"Moves hardcoded per-agent telegram secrets from config.json into ~/.outclaw/.env.",
	]);
}

export function printConfigSecureUsage() {
	console.log(formatConfigSecureUsage());
}

export function formatSessionUsage() {
	return joinLines([
		"Usage: oc session <list|search|transcript>",
		"       oc session list [--limit N] [--tag cron]",
		"       oc session search <query> [--limit N]",
		"       oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
		"",
		"Commands:",
		"       list        list recent sessions",
		"       search      search chat sessions by text",
		"       transcript  print a session transcript",
		"",
		"Run inside an agent workspace to scope results to that agent.",
	]);
}

export function printSessionUsage() {
	console.log(formatSessionUsage());
}

export function formatSessionListUsage() {
	return joinLines([
		"Usage: oc session list [--limit N] [--tag cron]",
		"",
		"Lists recent sessions.",
		"Default limit: 20",
		"Default tag: chat",
	]);
}

export function printSessionListUsage() {
	console.log(formatSessionListUsage());
}

export function formatSessionSearchUsage() {
	return joinLines([
		"Usage: oc session search <query> [--limit N]",
		"",
		"Searches chat sessions by text.",
		"No default limit is applied unless --limit is passed.",
	]);
}

export function printSessionSearchUsage() {
	console.log(formatSessionSearchUsage());
}

export function formatSessionTranscriptUsage() {
	return joinLines([
		"Usage: oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
		"",
		"Prints one session transcript.",
		"Use a session id or unique prefix.",
		"Default tag: chat",
	]);
}

export function printSessionTranscriptUsage() {
	console.log(formatSessionTranscriptUsage());
}
