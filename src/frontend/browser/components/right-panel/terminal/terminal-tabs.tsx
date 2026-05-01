import { Play, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type {
	BrowserTerminalEntry,
	BrowserTerminalTab,
} from "../../../stores/terminal.ts";

interface TerminalTabsProps {
	activeTerminalId: string | null;
	activeTab: BrowserTerminalTab;
	canRunCommand: boolean;
	leadingContent?: ReactNode;
	onCloseTerminal: (terminalId: string) => void;
	onCreateTerminal: () => void;
	onRenameTerminal: (terminalId: string, name: string) => void;
	onRunCommand: () => void;
	onSelectRun: () => void;
	onSelectTerminal: (terminalId: string) => void;
	terminals: BrowserTerminalEntry[];
}

export function TerminalTabs({
	activeTerminalId,
	activeTab,
	canRunCommand,
	leadingContent,
	onCloseTerminal,
	onCreateTerminal,
	onRenameTerminal,
	onRunCommand,
	onSelectRun,
	onSelectTerminal,
	terminals,
}: TerminalTabsProps) {
	const [editingTerminalId, setEditingTerminalId] = useState<string | null>(
		null,
	);
	const [draftName, setDraftName] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!editingTerminalId) {
			return;
		}

		if (!terminals.some((terminal) => terminal.id === editingTerminalId)) {
			setEditingTerminalId(null);
			setDraftName("");
		}
	}, [editingTerminalId, terminals]);

	useEffect(() => {
		if (!editingTerminalId) {
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [editingTerminalId]);

	function startEditing(terminal: BrowserTerminalEntry) {
		setEditingTerminalId(terminal.id);
		setDraftName(terminal.name);
	}

	function commitRename(terminalId: string) {
		onRenameTerminal(terminalId, draftName);
		setEditingTerminalId(null);
		setDraftName("");
	}

	function cancelRename() {
		setEditingTerminalId(null);
		setDraftName("");
	}

	if (terminals.length === 0) {
		return (
			<div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-dark-800 px-2">
				<div className="flex min-w-0 items-center gap-3">
					{leadingContent}
					<RunTab active={activeTab === "run"} onSelectRun={onSelectRun} />
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.12em] text-dark-500">
						Terminal
					</div>
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={onCreateTerminal}
						className="flex items-center justify-center text-dark-700 transition-colors hover:text-dark-500"
						aria-label="Create terminal"
					>
						<Plus size={16} />
					</button>
					<RunCommandButton
						canRunCommand={canRunCommand}
						onRunCommand={onRunCommand}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-8 shrink-0 items-stretch gap-3 border-b border-dark-800 px-2">
			{leadingContent ? (
				<div className="flex shrink-0 items-center">{leadingContent}</div>
			) : null}
			<div className="scrollbar-none flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden">
				<RunTab active={activeTab === "run"} onSelectRun={onSelectRun} />
				{terminals.map((terminal) => {
					const isActive =
						activeTab === "terminal" && terminal.id === activeTerminalId;
					const isEditing = terminal.id === editingTerminalId;

					return (
						<div
							key={terminal.id}
							className={`group relative grid shrink-0 items-stretch text-[11px] uppercase tracking-[0.12em] ${
								isActive
									? "text-dark-50"
									: "text-dark-500 transition-colors hover:text-dark-200"
							}`}
						>
							{isActive ? (
								<span className="absolute inset-x-0 bottom-0 -mb-px h-0.5 bg-brand" />
							) : null}
							<span
								aria-hidden="true"
								className="invisible col-start-1 row-start-1 flex h-full items-center font-mono-ui"
							>
								{terminal.name}
							</span>

							{isEditing ? (
								<input
									ref={inputRef}
									value={draftName}
									onChange={(event) => setDraftName(event.target.value)}
									onBlur={() => commitRename(terminal.id)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											commitRename(terminal.id);
										}
										if (event.key === "Escape") {
											event.preventDefault();
											cancelRename();
										}
									}}
									className="col-start-1 row-start-1 h-full min-w-0 border-none bg-transparent font-mono-ui text-[11px] uppercase tracking-[0.12em] text-dark-100"
									aria-label={`Rename ${terminal.name}`}
								/>
							) : (
								<button
									type="button"
									onClick={() => onSelectTerminal(terminal.id)}
									onDoubleClick={() => startEditing(terminal)}
									className="absolute inset-0 flex h-full min-w-0 items-center overflow-hidden font-mono-ui transition-[padding] group-hover:pr-5"
								>
									<span className="min-w-0 truncate">{terminal.name}</span>
								</button>
							)}

							{isEditing ? null : (
								<button
									type="button"
									onClick={() => onCloseTerminal(terminal.id)}
									className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center justify-center text-dark-500 opacity-0 transition-opacity hover:text-dark-100 group-hover:opacity-100"
									aria-label={`Close ${terminal.name}`}
								>
									<X size={14} />
								</button>
							)}
						</div>
					);
				})}
			</div>

			<button
				type="button"
				onClick={onCreateTerminal}
				className="ml-2 flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100"
				aria-label="Create terminal"
			>
				<Plus size={16} />
			</button>
			<RunCommandButton
				canRunCommand={canRunCommand}
				onRunCommand={onRunCommand}
			/>
		</div>
	);
}

function RunTab({
	active,
	onSelectRun,
}: {
	active: boolean;
	onSelectRun: () => void;
}) {
	return (
		<div
			className={`relative flex shrink-0 items-stretch text-[11px] uppercase tracking-[0.12em] ${
				active
					? "text-dark-50"
					: "text-dark-500 transition-colors hover:text-dark-200"
			}`}
		>
			{active ? (
				<span className="absolute inset-x-0 bottom-0 -mb-px h-0.5 bg-brand" />
			) : null}
			<button
				type="button"
				onClick={onSelectRun}
				className="h-full min-w-0 font-mono-ui"
				aria-label="Select run tab"
			>
				Run
			</button>
		</div>
	);
}

function RunCommandButton({
	canRunCommand,
	onRunCommand,
}: {
	canRunCommand: boolean;
	onRunCommand: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onRunCommand}
			disabled={!canRunCommand}
			className="flex items-center justify-center text-dark-500 transition-colors hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-dark-500"
			aria-label="Run command"
		>
			<Play size={14} />
		</button>
	);
}
