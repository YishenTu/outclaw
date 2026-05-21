import { Play, TerminalSquare, X } from "lucide-react";
import type { FormEvent } from "react";
import type { BrowserTerminalRuntimeState } from "../../../stores/terminal.ts";
import { createTerminalTarget } from "./terminal-target.ts";
import type { TerminalRunRequest } from "./terminal-view.tsx";
import { TerminalView } from "./terminal-view.tsx";

const RUN_PANEL_ICON_SIZE = 40;
const MONO_CAPS =
	"font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-300";

interface TerminalRunPanelProps {
	active: boolean;
	agentId: string | null;
	command: string;
	draftCommand: string;
	editingCommand?: boolean;
	error: string | null;
	executedCommand: string | null;
	onCancelEditCommand?: () => void;
	onDraftCommandChange: (command: string) => void;
	onRun: () => void;
	onSave: () => void;
	onRunRequestDispatched: (requestId: number) => void;
	providerId?: string;
	repositoryId?: string;
	runRequest: TerminalRunRequest | null;
	runTerminalRuntimeState?: BrowserTerminalRuntimeState | null;
	saving: boolean;
	sdkSessionId?: string;
}

export function TerminalRunPanel({
	active,
	agentId,
	command,
	draftCommand,
	editingCommand = false,
	error,
	executedCommand,
	onCancelEditCommand,
	onDraftCommandChange,
	onRun,
	onSave,
	onRunRequestDispatched,
	providerId,
	repositoryId,
	runRequest,
	runTerminalRuntimeState,
	saving,
	sdkSessionId,
}: TerminalRunPanelProps) {
	if (!agentId) {
		return null;
	}

	const configuredCommand = command.trim();
	const hasConfiguredCommand = configuredCommand.length > 0;
	const canSave = draftCommand.trim().length > 0 && !saving;
	const shouldShowCommandForm = !hasConfiguredCommand || editingCommand;
	const hasRestoredRunTerminal = runTerminalRuntimeState === "ready";
	const shouldRenderTerminal =
		!editingCommand &&
		(hasRestoredRunTerminal ||
			(hasConfiguredCommand && executedCommand === configuredCommand));

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (canSave) {
			onSave();
		}
	}

	if (!shouldRenderTerminal) {
		return (
			<div
				className={`h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-dark-950 ${
					active ? "flex" : "hidden"
				}`}
			>
				<div className="flex h-full w-full items-center justify-center px-5 py-6">
					{hasConfiguredCommand && !editingCommand ? (
						<div className="flex flex-col items-center gap-4">
							<TerminalSquare
								size={RUN_PANEL_ICON_SIZE}
								className="text-dark-500"
							/>
							<button
								type="button"
								onClick={onRun}
								disabled={saving}
								aria-label="Run saved command"
								className={`inline-flex h-11 items-center gap-2 rounded-md border border-dark-700 px-8 transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-dark-700 disabled:hover:text-dark-300 ${MONO_CAPS}`}
							>
								<Play size={13} fill="currentColor" />
								Run command
							</button>
						</div>
					) : shouldShowCommandForm ? (
						<form
							onSubmit={handleSubmit}
							className="flex w-full max-w-md flex-col items-center gap-4"
						>
							<TerminalSquare
								size={RUN_PANEL_ICON_SIZE}
								className="text-dark-500"
							/>
							<div className={MONO_CAPS}>
								{editingCommand && hasConfiguredCommand
									? "Edit run command"
									: "Set up run command"}
							</div>
							<div className="flex h-11 w-full items-stretch overflow-hidden rounded-md border border-dark-700 transition-colors focus-within:border-brand/70">
								<input
									type="text"
									value={draftCommand}
									onChange={(event) =>
										onDraftCommandChange(event.currentTarget.value)
									}
									disabled={saving}
									placeholder="Command"
									aria-label="Run command"
									className="min-w-0 flex-1 bg-transparent px-3 font-mono-ui text-sm text-dark-50 outline-none placeholder:text-dark-600"
								/>
								<button
									type="submit"
									disabled={!canSave}
									className={`inline-flex shrink-0 items-center border-l border-dark-700 px-6 transition-colors hover:bg-dark-900 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dark-300 ${MONO_CAPS}`}
								>
									{saving ? "Saving" : "Save"}
								</button>
								{editingCommand && onCancelEditCommand ? (
									<button
										type="button"
										onClick={onCancelEditCommand}
										disabled={saving}
										className="inline-flex shrink-0 items-center border-l border-dark-700 px-3 text-dark-400 transition-colors hover:bg-dark-900 hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dark-400"
										aria-label="Cancel editing run command"
									>
										<X size={14} />
									</button>
								) : null}
							</div>
							{error ? (
								<div className="font-mono-ui text-xs text-danger">{error}</div>
							) : null}
						</form>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div
			className={`h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-dark-950 ${
				active ? "flex" : "hidden"
			}`}
		>
			<TerminalView
				key={`${agentId}:run`}
				active={active}
				name="Run"
				onRunRequestDispatched={onRunRequestDispatched}
				runRequest={runRequest}
				runtimeState={runTerminalRuntimeState ?? "pending"}
				scopeId={agentId}
				target={createTerminalTarget({
					scopeId: agentId,
					providerId,
					repositoryId,
					sdkSessionId,
				})}
				terminalId={`${agentId}:run`}
			/>
		</div>
	);
}
