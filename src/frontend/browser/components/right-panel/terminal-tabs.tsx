import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BrowserTerminalEntry } from "../../stores/terminal.ts";

interface TerminalTabsProps {
	activeTerminalId: string | null;
	canCloseTerminals: boolean;
	onCloseTerminal: (terminalId: string) => void;
	onCreateTerminal: () => void;
	onRenameTerminal: (terminalId: string, name: string) => void;
	onSelectTerminal: (terminalId: string) => void;
	terminals: BrowserTerminalEntry[];
}

export function TerminalTabs({
	activeTerminalId,
	canCloseTerminals,
	onCloseTerminal,
	onCreateTerminal,
	onRenameTerminal,
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

	return (
		<div className="flex h-8 shrink-0 items-stretch gap-1 border-b border-dark-800 px-2">
			<div className="scrollbar-none flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto overflow-y-hidden">
				{terminals.map((terminal) => {
					const isActive = terminal.id === activeTerminalId;
					const isEditing = terminal.id === editingTerminalId;

					return (
						<div
							key={terminal.id}
							className={`group relative flex shrink-0 items-stretch text-[11px] uppercase tracking-[0.12em] ${
								isActive
									? "text-dark-100"
									: "text-dark-500 transition-colors hover:text-dark-200"
							}`}
						>
							{isActive ? (
								<span className="absolute inset-x-0 bottom-0 -mb-px h-px bg-dark-100" />
							) : null}

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
									className="min-w-0 border-none bg-transparent py-2 font-mono-ui text-[11px] uppercase tracking-[0.12em] text-dark-100"
									aria-label={`Rename ${terminal.name}`}
								/>
							) : (
								<button
									type="button"
									onClick={() => onSelectTerminal(terminal.id)}
									onDoubleClick={() => startEditing(terminal)}
									className="h-full min-w-0 font-mono-ui"
								>
									{terminal.name}
								</button>
							)}

							{canCloseTerminals ? (
								<button
									type="button"
									onClick={() => onCloseTerminal(terminal.id)}
									className="flex items-center justify-center pl-2 text-dark-500 opacity-0 transition-opacity hover:text-dark-100 group-hover:opacity-100"
									aria-label={`Close ${terminal.name}`}
								>
									<X size={14} />
								</button>
							) : null}
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
		</div>
	);
}
