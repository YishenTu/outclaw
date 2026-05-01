import { useCallback, useEffect, useState } from "react";
import { extractError } from "../../../../../common/protocol.ts";
import { updateAgentTerminalRunCommand } from "../../../lib/api.ts";

interface AgentTerminalRunCommandState {
	error: string | null;
	saving: boolean;
}

type TerminalRunCommandSaveEffect = () => string | null;

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
	const [state, setState] = useState<AgentTerminalRunCommandState>(EMPTY_STATE);
	const [draftCommand, setDraftCommandState] = useState("");
	const command = typeof runtimeCommand === "string" ? runtimeCommand : "";

	useEffect(() => {
		if (!agentId || command.trim().length === 0) {
			setState(EMPTY_STATE);
			setDraftCommandState("");
			return;
		}

		setState(EMPTY_STATE);
		setDraftCommandState(command);
	}, [agentId, command]);

	const setDraftCommand = useCallback(
		(value: string) => {
			if (!agentId) {
				return;
			}

			setDraftCommandState(value);
			setState((current) => ({
				...current,
				error: null,
			}));
		},
		[agentId],
	);

	const saveDraftCommand = useCallback(async (): Promise<string | null> => {
		if (!agentId) {
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
			await updateAgentTerminalRunCommand(agentId, command);
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
	}, [agentId, draftCommand, onSaveSucceeded]);

	return {
		command,
		draftCommand,
		error: state.error,
		saveDraftCommand,
		saving: state.saving,
		setDraftCommand,
	};
}
