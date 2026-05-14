import { useCallback, useEffect, useState } from "react";
import { extractError } from "../../../../../common/protocol.ts";
import { updateAgentTerminalRunCommand } from "../../../lib/api.ts";

interface AgentTerminalRunCommandState {
	error: string | null;
	saving: boolean;
}

type TerminalRunCommandSaveEffect = () => string | null;
type TerminalRunCommandSave = (
	scopeId: string,
	command: string,
) => Promise<{ command: string }>;

const EMPTY_STATE: AgentTerminalRunCommandState = {
	error: null,
	saving: false,
};

export type HeaderTerminalRunAction =
	| {
			command: string;
			type: "run";
	  }
	| {
			type: "select";
	  };

export function resolveSavedTerminalRunCommand(command: string): string | null {
	const savedCommand = command.trim();
	return savedCommand.length > 0 ? savedCommand : null;
}

export function resolveHeaderTerminalRunAction({
	command,
}: {
	command: string;
}): HeaderTerminalRunAction {
	const savedCommand = resolveSavedTerminalRunCommand(command);
	return savedCommand
		? { command: savedCommand, type: "run" }
		: { type: "select" };
}

export function useAgentTerminalRunCommand(
	agentId: string | null,
	runtimeCommand: string,
	onSaveSucceeded?: TerminalRunCommandSaveEffect,
) {
	return useTerminalRunCommand(
		agentId,
		runtimeCommand,
		updateAgentTerminalRunCommand,
		onSaveSucceeded,
	);
}

export function useTerminalRunCommand(
	scopeId: string | null,
	runtimeCommand: string,
	saveCommand: TerminalRunCommandSave,
	onSaveSucceeded?: TerminalRunCommandSaveEffect,
) {
	const [state, setState] = useState<AgentTerminalRunCommandState>(EMPTY_STATE);
	const [draftCommand, setDraftCommandState] = useState("");
	const command = typeof runtimeCommand === "string" ? runtimeCommand : "";

	useEffect(() => {
		if (!scopeId || command.trim().length === 0) {
			setState(EMPTY_STATE);
			setDraftCommandState("");
			return;
		}

		setState(EMPTY_STATE);
		setDraftCommandState(command);
	}, [scopeId, command]);

	const setDraftCommand = useCallback(
		(value: string) => {
			if (!scopeId) {
				return;
			}

			setDraftCommandState(value);
			setState((current) => ({
				...current,
				error: null,
			}));
		},
		[scopeId],
	);

	const saveDraftCommand = useCallback(async (): Promise<string | null> => {
		if (!scopeId) {
			return null;
		}

		const command = draftCommand.trim();
		if (!command) {
			setState((current) => ({
				...current,
				error: "Run command is empty",
			}));
			return null;
		}

		setState((current) => ({
			...current,
			error: null,
			saving: true,
		}));

		try {
			await saveCommand(scopeId, command);
			const saveEffectError = onSaveSucceeded?.() ?? null;
			if (saveEffectError) {
				setState({
					error: saveEffectError,
					saving: false,
				});
				return null;
			}
			setState({
				error: null,
				saving: false,
			});
			return command;
		} catch (error) {
			setState((current) => ({
				...current,
				error: extractError(error),
				saving: false,
			}));
			return null;
		}
	}, [draftCommand, onSaveSucceeded, saveCommand, scopeId]);

	return {
		command,
		draftCommand,
		error: state.error,
		saveDraftCommand,
		saving: state.saving,
		setDraftCommand,
	};
}
