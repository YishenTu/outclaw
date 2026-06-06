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
		"Usage: oc <start|stop|restart|status|tui|browser|onboard|dev|build>",
		"       oc start|restart [--lan] [--host HOST]",
		"       oc onboard",
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
