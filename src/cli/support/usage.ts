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
		"Usage: oc <start|stop|restart|status|tui|browser|onboard|dev|build|agent|config|session|cron|note|schema>",
		"       oc start|restart [--lan] [--host HOST]",
		"       oc onboard",
		"       oc agent <list|create|config|rename|remove|ask|send|name>",
		"       oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N] [--thinking-effort LEVEL]",
		"       oc config secure",
		"       oc session list [--limit N] [--tag cron]",
		"       oc session search <query> [--limit N]",
		"       oc session transcript <id-or-prefix> [--limit N] [--tag cron]",
		"       oc cron run <cron-name>",
		"       oc cron status --failed [--since DURATION|DATE] [--limit N] [--job NAME] [--names] [--json]",
		'       oc note "<content>" [--salience <tag>] [--hint <schema>]',
		"       oc schema <status|stale> [--agent <name|id>] [--json]",
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

export function formatOnboardUsage() {
	return joinLines([
		"Usage: oc onboard",
		"",
		"Launch the interactive agent onboarding TUI.",
		"Creates a new agent workspace and updates ~/.outclaw/config.json.",
	]);
}

export function printOnboardUsage() {
	console.log(formatOnboardUsage());
}

export function formatAgentUsage() {
	return joinLines([
		"Usage: oc agent <list|create|config|rename|remove|ask|send|name>",
		"       oc agent create <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>] [--rollover-idle <minutes>]",
		"       oc agent config <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>] [--rollover-idle <minutes>]",
		"       oc agent rename <old-name> <new-name>",
		"       oc agent remove <name>",
		'       oc agent ask --to <target> [--timeout <seconds>] "<message>"',
		'       oc agent send --to <target> "<message>"',
		"",
		"Commands:",
		"       list      list configured agents",
		"       create    create an agent workspace and config",
		"       config    update telegram settings for an agent",
		"       rename    rename an agent",
		"       remove    remove an agent",
		"       ask       ask another agent and wait for the response",
		"       send      send another agent a message without waiting",
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
		"Usage: oc agent create <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>] [--rollover-idle <minutes>]",
		"",
		"Creates an agent workspace under ~/.outclaw/agents/<name> and registers it in config.json.",
	]);
}

export function printAgentCreateUsage() {
	console.log(formatAgentCreateUsage());
}

export function formatAgentConfigUsage() {
	return joinLines([
		"Usage: oc agent config <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>] [--rollover-idle <minutes>]",
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

export function formatAgentSendUsage() {
	return joinLines([
		'Usage: oc agent send --to <target> "<message>"',
		"",
		"Send a message from the current agent workspace to another agent without waiting for the result.",
		"Run this inside an agent workspace so the sender can be resolved from cwd.",
	]);
}

export function printAgentSendUsage() {
	console.log(formatAgentSendUsage());
}

export function formatConfigUsage() {
	return joinLines([
		"Usage: oc config <runtime|secure>",
		"       oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N] [--thinking-effort LEVEL]",
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
		"Usage: oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N] [--thinking-effort LEVEL]",
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

export function formatCronUsage() {
	return joinLines([
		"Usage: oc cron <run|status>",
		"       oc cron run <cron-name>",
		"       oc cron status --failed [--since DURATION|DATE] [--limit N] [--job NAME] [--names] [--json]",
		"",
		"Commands:",
		"       run     trigger a cron job in the running daemon",
		"       status  list failed cron runs",
		"",
		"Run inside an agent workspace so the agent can be resolved from cwd.",
	]);
}

export function printCronUsage() {
	console.log(formatCronUsage());
}

export function formatCronRunUsage() {
	return joinLines([
		"Usage: oc cron run <cron-name>",
		"",
		"Triggers a cron job in the running daemon.",
		"Run inside an agent workspace so the agent can be resolved from cwd.",
		"On success, prints nothing; cron delivery uses the normal cron path.",
	]);
}

export function printCronRunUsage() {
	console.log(formatCronRunUsage());
}

export function formatCronStatusUsage() {
	return joinLines([
		"Usage: oc cron status --failed [--since DURATION|DATE] [--limit N] [--job NAME] [--names] [--json]",
		"",
		"Lists failed cron runs.",
		"Default since: 7d",
		"Use --names when piping failed job names into oc cron run.",
		"Run inside an agent workspace to scope results to that agent.",
	]);
}

export function printCronStatusUsage() {
	console.log(formatCronStatusUsage());
}

export function formatSchemaUsage() {
	return joinLines([
		"Usage: oc schema <status|stale>",
		"       oc schema status [--agent <name|id>] [--json]",
		"       oc schema stale [--agent <name|id>] [--json]",
		"",
		"Commands:",
		"       status   list all schemas with freshness state",
		"       stale    list stale and broken schemas",
		"",
		"Run inside an agent workspace to inspect that agent's schemas.",
	]);
}

export function printSchemaUsage() {
	console.log(formatSchemaUsage());
}

export function formatSchemaStatusUsage() {
	return joinLines([
		"Usage: oc schema status [--agent <name|id>] [--json]",
		"       oc schema stale [--agent <name|id>] [--json]",
		"",
		"Reads schemas/*.md and compares last_observation_at to last_synthesized.",
		"Use --agent outside an agent workspace.",
	]);
}

export function printSchemaStatusUsage() {
	console.log(formatSchemaStatusUsage());
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
