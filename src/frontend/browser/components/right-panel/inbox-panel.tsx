import {
	Archive,
	ChevronDown,
	ChevronRight,
	FileText,
	Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
	BrowserInboxItem,
	BrowserInboxResponse,
} from "../../../../common/protocol.ts";

export interface InboxUndoArchive {
	archivedPath: string;
	expiresAtMs: number;
	name: string;
	originalPath: string;
}

interface InboxPanelProps {
	agentId: string;
	agentName?: string | null;
	defaultArchiveExpanded?: boolean;
	defaultNoteComposerOpen?: boolean;
	error: string | null;
	inbox: BrowserInboxResponse | null;
	loading: boolean;
	onArchive: (path: string) => void;
	onCreateNote: (input: { body: string; title: string }) => Promise<void>;
	onOpenFile: (params: { agentId: string; path: string }) => void;
	onUndoArchive: () => void;
	undoArchive: InboxUndoArchive | null;
}

export function InboxPanel({
	agentId,
	agentName,
	defaultArchiveExpanded = false,
	defaultNoteComposerOpen = false,
	error,
	inbox,
	loading,
	onArchive,
	onCreateNote,
	onOpenFile,
	onUndoArchive,
	undoArchive,
}: InboxPanelProps) {
	const [archiveExpanded, setArchiveExpanded] = useState(
		defaultArchiveExpanded,
	);
	const [composerOpen, setComposerOpen] = useState(defaultNoteComposerOpen);
	const [noteBody, setNoteBody] = useState("");
	const [noteTitle, setNoteTitle] = useState("");
	const [savingNote, setSavingNote] = useState(false);
	const [undoNowMs, setUndoNowMs] = useState(() => Date.now());
	const path = agentName
		? `~/.outclaw/agents/${agentName}/inbox`
		: "~/.outclaw/agents/inbox";
	const visibleUndoArchive =
		undoArchive && undoArchive.expiresAtMs > undoNowMs ? undoArchive : null;
	const canSaveNote = noteTitle.trim().length > 0 || noteBody.trim().length > 0;

	useEffect(() => {
		setUndoNowMs(Date.now());
		if (!undoArchive) {
			return;
		}

		const remainingMs = undoArchive.expiresAtMs - Date.now();
		if (remainingMs <= 0) {
			return;
		}

		const timer = setTimeout(() => {
			setUndoNowMs(Date.now());
		}, remainingMs);

		return () => clearTimeout(timer);
	}, [undoArchive]);

	async function handleCreateNote(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSaveNote || savingNote) {
			return;
		}

		setSavingNote(true);
		try {
			await onCreateNote({
				body: noteBody,
				title: noteTitle,
			});
			setNoteBody("");
			setNoteTitle("");
			setComposerOpen(false);
		} catch {
			// The parent owns surfacing the API error in the panel error slot.
		} finally {
			setSavingNote(false);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="h-8 shrink-0 border-b border-dark-800 px-3">
				<div className="flex h-full items-center justify-between gap-3 px-1">
					<div className="font-mono-ui truncate text-[11px] uppercase tracking-[0.16em] text-dark-500">
						{path}
					</div>
					<button
						type="button"
						onClick={() => setComposerOpen((open) => !open)}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-dark-500 transition-colors hover:bg-dark-900 hover:text-dark-100"
						aria-label="Add inbox note"
					>
						<Plus size={14} />
					</button>
				</div>
			</div>
			{composerOpen ? (
				<form
					onSubmit={handleCreateNote}
					className="shrink-0 border-b border-dark-800 px-4 py-3"
				>
					<input
						type="text"
						value={noteTitle}
						onChange={(event) => setNoteTitle(event.currentTarget.value)}
						placeholder="Title"
						className="mb-2 h-8 w-full rounded border border-dark-800 bg-dark-950 px-2 text-sm text-dark-100 outline-none placeholder:text-dark-600 focus:border-dark-600"
					/>
					<textarea
						value={noteBody}
						onChange={(event) => setNoteBody(event.currentTarget.value)}
						placeholder="Note"
						rows={4}
						className="block w-full resize-none rounded border border-dark-800 bg-dark-950 px-2 py-2 text-sm text-dark-100 outline-none placeholder:text-dark-600 focus:border-dark-600"
					/>
					<div className="mt-2 flex justify-end gap-2">
						<button
							type="button"
							onClick={() => setComposerOpen(false)}
							className="rounded px-2 py-1 text-xs text-dark-500 transition-colors hover:bg-dark-900 hover:text-dark-100"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!canSaveNote || savingNote}
							className="rounded bg-dark-100 px-2 py-1 text-xs font-medium text-dark-950 transition-colors hover:bg-dark-200 disabled:cursor-not-allowed disabled:bg-dark-800 disabled:text-dark-500"
						>
							{savingNote ? "Saving..." : "Save"}
						</button>
					</div>
				</form>
			) : null}
			{visibleUndoArchive ? (
				<div className="border-b border-dark-800 px-4 py-2">
					<div className="flex items-center justify-between gap-3 text-sm">
						<span className="min-w-0 truncate text-dark-300">
							Archived {visibleUndoArchive.name}
						</span>
						<button
							type="button"
							onClick={onUndoArchive}
							className="font-mono-ui shrink-0 rounded-full border border-dark-700 bg-dark-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-dark-400 transition-colors hover:border-dark-600 hover:bg-dark-800 hover:text-dark-50"
						>
							Undo
						</button>
					</div>
				</div>
			) : null}
			{loading ? (
				<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-3">
					<div className="px-1 py-1 text-sm text-dark-500">
						Loading inbox...
					</div>
				</div>
			) : error ? (
				<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-3">
					<div className="px-1 py-1 text-sm text-danger">{error}</div>
				</div>
			) : inbox ? (
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-3">
						<InboxSection title="Pending">
							{inbox.items.length > 0 ? (
								inbox.items.map((item) => (
									<InboxItemRow
										key={item.path}
										agentId={agentId}
										item={item}
										onArchive={onArchive}
										onOpenFile={onOpenFile}
										showArchive
									/>
								))
							) : (
								<EmptyInboxMessage>No pending items.</EmptyInboxMessage>
							)}
						</InboxSection>
					</div>
					<ArchiveSection
						expanded={archiveExpanded}
						onToggle={() => setArchiveExpanded((expanded) => !expanded)}
					>
						{inbox.archivedItems.length > 0 ? (
							inbox.archivedItems.map((item) => (
								<InboxItemRow
									key={item.path}
									agentId={agentId}
									item={item}
									onArchive={onArchive}
									onOpenFile={onOpenFile}
								/>
							))
						) : (
							<EmptyInboxMessage>No archived items.</EmptyInboxMessage>
						)}
					</ArchiveSection>
				</div>
			) : (
				<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-3">
					<div className="px-1 py-1 text-sm text-dark-500">
						No inbox loaded.
					</div>
				</div>
			)}
		</div>
	);
}

function ArchiveSection({
	children,
	expanded,
	onToggle,
}: {
	children: React.ReactNode;
	expanded: boolean;
	onToggle: () => void;
}) {
	const ArchiveChevron = expanded ? ChevronDown : ChevronRight;

	return (
		<section className="shrink-0 border-t border-dark-800 px-3 py-2">
			<button
				type="button"
				aria-expanded={expanded}
				onClick={onToggle}
				className={`font-mono-ui flex w-full items-center gap-2 px-1 text-left text-[11px] uppercase tracking-[0.16em] text-dark-500 transition-colors hover:text-dark-200 ${
					expanded ? "mb-2" : ""
				}`}
			>
				<ArchiveChevron size={13} className="shrink-0" />
				<span>Archive</span>
			</button>
			{expanded ? (
				<div className="scrollbar-none max-h-64 overflow-y-auto">
					<div className="space-y-1">{children}</div>
				</div>
			) : null}
		</section>
	);
}

function InboxSection({
	children,
	title,
}: {
	children: React.ReactNode;
	title: string;
}) {
	return (
		<section>
			<div className="font-mono-ui mb-2 px-1 text-[11px] uppercase tracking-[0.16em] text-dark-500">
				{title}
			</div>
			<div className="space-y-1">{children}</div>
		</section>
	);
}

function InboxItemRow({
	agentId,
	item,
	onArchive,
	onOpenFile,
	showArchive = false,
}: {
	agentId: string;
	item: BrowserInboxItem;
	onArchive: (path: string) => void;
	onOpenFile: (params: { agentId: string; path: string }) => void;
	showArchive?: boolean;
}) {
	return (
		<div className="flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors hover:bg-dark-900">
			<button
				type="button"
				onClick={() => onOpenFile({ agentId, path: item.path })}
				className="flex min-w-0 flex-1 items-center gap-2 text-left"
			>
				<FileText size={14} className="shrink-0 text-dark-500" />
				<span className="truncate text-dark-100">{item.name}</span>
			</button>
			{showArchive ? (
				<button
					type="button"
					onClick={() => onArchive(item.path)}
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-dark-500 transition-colors hover:bg-dark-800 hover:text-dark-100"
					aria-label={`Archive ${item.name}`}
				>
					<Archive size={14} />
				</button>
			) : null}
		</div>
	);
}

function EmptyInboxMessage({ children }: { children: React.ReactNode }) {
	return <div className="px-1 py-1 text-sm text-dark-500">{children}</div>;
}
