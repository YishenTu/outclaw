import type { CommandEntry } from "../../../stores/slash-commands.ts";

export function isSlashAutocompleteInput(
	value: string,
	triggerChars: readonly string[] = ["/"],
): boolean {
	return (
		value.length > 0 &&
		triggerChars.includes(value[0] ?? "") &&
		!value.includes(" ") &&
		!value.includes("\n")
	);
}

export function filterSlashCommands(
	value: string,
	commands: CommandEntry[],
	triggerChars: readonly string[] = ["/"],
): CommandEntry[] {
	if (!isSlashAutocompleteInput(value, triggerChars)) {
		return [];
	}

	const filter = value.slice(1).toLowerCase();
	return commands.filter((command) =>
		command.name.toLowerCase().startsWith(filter),
	);
}

export function shouldShowSlashCommandMenu(params: {
	filteredCommandCount: number;
	hasEmptyMessage: boolean;
	isTriggerActive: boolean;
	showMentionMenu: boolean;
}): boolean {
	if (params.showMentionMenu) {
		return false;
	}
	if (params.filteredCommandCount > 0) {
		return true;
	}
	return params.isTriggerActive && params.hasEmptyMessage;
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
