import type { CommandEntry } from "../../../stores/slash-commands.ts";

export function isSlashAutocompleteInput(value: string): boolean {
	return value.startsWith("/") && !value.includes(" ") && !value.includes("\n");
}

export function filterSlashCommands(
	value: string,
	commands: CommandEntry[],
): CommandEntry[] {
	if (!isSlashAutocompleteInput(value)) {
		return [];
	}

	const filter = value.slice(1).toLowerCase();
	return commands.filter((command) =>
		command.name.toLowerCase().startsWith(filter),
	);
}

export function resolveRuntimePopupItemCount(
	popup:
		| { kind: "agent"; agents: unknown[] }
		| { kind: "session"; sessions: unknown[] }
		| { kind: "status" }
		| null,
): number {
	if (popup?.kind === "agent") {
		return popup.agents.length;
	}
	if (popup?.kind === "session") {
		return popup.sessions.length;
	}
	return 0;
}

export function canSubmitMessageInput(params: {
	disabled: boolean;
	imageCount: number;
	submitting: boolean;
	value: string;
}): boolean {
	return (
		!params.disabled &&
		!params.submitting &&
		(params.value.trim() !== "" || params.imageCount > 0)
	);
}
