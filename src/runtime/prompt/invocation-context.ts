export interface InvocationContextOptions {
	source?: string;
	sessionId?: string;
	now?: Date;
}

export function buildInvocationContext(
	options: InvocationContextOptions,
): string {
	const now = options.now ?? new Date();
	const source = options.source ?? "tui";
	const session = options.sessionId ?? "new session";

	const date = now.toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	const time = now.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});

	return [
		"## Invocation Context",
		"",
		`- **Date:** ${date}, ${time}`,
		`- **Source:** ${source}`,
		`- **Session:** ${session}`,
	].join("\n");
}
