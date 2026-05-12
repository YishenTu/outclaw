import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatLastActive } from "./format-last-active.ts";

type SessionItemActionIcon = "archive" | "restore" | "trash";
type SessionItemActionTone = "danger" | "neutral";

interface SessionItemProps {
	title: string;
	lastActive: number;
	isActive: boolean;
	onSelect: () => void;
	onRename: (title: string) => void;
	onDelete: () => void;
	actionAriaLabel?: string;
	actionConfirmBody?: ReactNode;
	actionConfirmLabel?: string;
	actionConfirmSubtitle?: string;
	actionConfirmTitle?: string;
	actionIcon?: SessionItemActionIcon;
	actionLabel?: string;
	actionRequiresConfirmation?: boolean;
	actionTone?: SessionItemActionTone;
}

export function SessionItem({
	title,
	lastActive,
	isActive,
	onSelect,
	onRename,
	onDelete,
	actionAriaLabel,
	actionConfirmBody,
	actionConfirmLabel,
	actionConfirmSubtitle = "This can't be undone",
	actionConfirmTitle,
	actionIcon = "trash",
	actionLabel = "Delete",
	actionRequiresConfirmation = true,
	actionTone = "danger",
}: SessionItemProps) {
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
	const [draftTitle, setDraftTitle] = useState(title);
	const [editing, setEditing] = useState(false);
	const [confirmingAction, setConfirmingAction] = useState(false);
	const [menuPosition, setMenuPosition] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const ActionIcon =
		actionIcon === "archive"
			? Archive
			: actionIcon === "restore"
				? RotateCcw
				: Trash2;
	const resolvedActionAriaLabel =
		actionAriaLabel ?? `${actionLabel} session ${title}`;
	const resolvedActionConfirmTitle =
		actionConfirmTitle ?? `${actionLabel} session`;
	const resolvedActionConfirmLabel = actionConfirmLabel ?? actionLabel;
	const actionTextClass =
		actionTone === "danger"
			? "text-danger hover:text-danger"
			: "text-dark-500 hover:text-dark-100";
	const actionIconClass =
		actionTone === "danger"
			? "border-danger/40 bg-danger/10 text-danger"
			: "border-dark-700 bg-dark-900 text-dark-300";
	const actionConfirmButtonClass =
		actionTone === "danger"
			? "border-danger/40 bg-danger/15 text-danger hover:bg-danger/25"
			: "border-dark-700 bg-dark-800 text-dark-100 hover:bg-dark-700";

	function startInlineRename() {
		setDraftTitle(title);
		setEditing(true);
		setMenuPosition(null);
	}

	function finishInlineRename(commit: boolean) {
		if (commit) {
			const nextTitle = draftTitle.trim();
			if (nextTitle !== "" && nextTitle !== title) {
				onRename(nextTitle);
			}
		}

		setEditing(false);
		setDraftTitle(title);
	}

	function handleAction() {
		setMenuPosition(null);
		if (actionRequiresConfirmation) {
			setConfirmingAction(true);
			return;
		}
		onDelete();
	}

	function confirmAction() {
		setConfirmingAction(false);
		onDelete();
	}

	function cancelAction() {
		setConfirmingAction(false);
	}

	useEffect(() => {
		if (!confirmingAction) {
			return;
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				setConfirmingAction(false);
			}
		}

		window.addEventListener("keydown", onKeyDown);
		const frameId = window.requestAnimationFrame(() => {
			cancelButtonRef.current?.focus();
		});

		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.cancelAnimationFrame(frameId);
		};
	}, [confirmingAction]);

	useEffect(() => {
		if (!menuPosition) {
			return;
		}

		function closeMenu() {
			setMenuPosition(null);
		}

		function handlePointerDown(event: PointerEvent) {
			if (menuRef.current?.contains(event.target as Node)) {
				return;
			}
			closeMenu();
		}

		document.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("blur", closeMenu);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("blur", closeMenu);
		};
	}, [menuPosition]);

	useEffect(() => {
		if (!editing) {
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		});

		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [editing]);

	useEffect(() => {
		if (editing) {
			return;
		}

		setDraftTitle(title);
	}, [editing, title]);

	return (
		<div className="group relative">
			{editing ? (
				<div
					className="w-full rounded px-2 py-1 text-left text-sm text-dark-100"
					style={{ paddingLeft: "16px" }}
				>
					<div className="flex min-w-0 items-center gap-1 pr-8">
						<div className="flex w-[14px] shrink-0 items-center justify-start">
							<div
								aria-hidden="true"
								className={`h-1.5 w-1.5 rounded-full ${
									isActive ? "bg-dark-100" : "opacity-0"
								}`}
							/>
						</div>
						<input
							ref={titleInputRef}
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
							onBlur={() => finishInlineRename(true)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									finishInlineRename(true);
									return;
								}

								if (event.key === "Escape") {
									event.preventDefault();
									finishInlineRename(false);
								}
							}}
							className="min-w-0 flex-1 bg-transparent text-sm font-medium text-dark-100 outline-none"
						/>
					</div>
				</div>
			) : (
				<>
					<button
						type="button"
						onClick={onSelect}
						onDoubleClick={(event) => {
							event.preventDefault();
							startInlineRename();
						}}
						onContextMenu={(event) => {
							event.preventDefault();
							setMenuPosition({
								x: event.clientX,
								y: event.clientY,
							});
						}}
						className={`w-full rounded px-2 py-1 text-left text-sm transition-colors ${
							isActive ? "text-dark-100" : "text-dark-500 hover:text-dark-300"
						}`}
						style={{ paddingLeft: "16px" }}
					>
						<div className="flex min-w-0 items-center gap-1 pr-8">
							<div className="flex w-[14px] shrink-0 items-center justify-start">
								<div
									aria-hidden="true"
									className={`h-1.5 w-1.5 rounded-full ${
										isActive ? "bg-dark-100" : "opacity-0"
									}`}
								/>
							</div>
							<div className="min-w-0 truncate text-sm font-medium">
								{title}
							</div>
						</div>
					</button>
					<div className="absolute inset-y-0 right-2 flex items-center">
						<div className="font-mono-ui w-8 shrink-0 text-right text-[10px] uppercase tracking-[0.12em] text-dark-500 group-hover:hidden">
							{formatLastActive(lastActive)}
						</div>
						<button
							type="button"
							aria-label={resolvedActionAriaLabel}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								handleAction();
							}}
							className={`hidden h-6 w-6 shrink-0 items-center justify-center transition-colors group-hover:flex ${actionTextClass}`}
						>
							<ActionIcon size={14} />
						</button>
					</div>
				</>
			)}

			{confirmingAction && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/80 px-4 py-6 backdrop-blur-sm"
					onPointerDown={(event) => {
						if (event.target === event.currentTarget) {
							cancelAction();
						}
					}}
				>
					<div
						role="dialog"
						aria-label={resolvedActionConfirmTitle}
						aria-modal="true"
						className="w-full max-w-sm overflow-hidden rounded-2xl border border-dark-800 bg-dark-950 shadow-2xl shadow-black/50"
					>
						<div className="flex items-center gap-3 bg-dark-900/40 px-4 py-3">
							<div
								className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${actionIconClass}`}
							>
								<ActionIcon size={14} />
							</div>
							<div className="min-w-0">
								<div className="font-display text-[13px] font-semibold uppercase tracking-[0.22em] text-dark-50">
									{resolvedActionConfirmTitle}
								</div>
								<div className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-dark-500">
									{actionConfirmSubtitle}
								</div>
							</div>
						</div>
						<div className="px-4 py-4 text-sm leading-6 text-dark-300">
							{actionConfirmBody ?? (
								<>
									Permanently delete session{" "}
									<span className="font-medium text-dark-50">
										&ldquo;{title}&rdquo;
									</span>
								</>
							)}
						</div>
						<div className="flex items-center justify-end gap-2 bg-dark-900/40 px-4 py-3">
							<button
								ref={cancelButtonRef}
								type="button"
								onClick={cancelAction}
								className="rounded-lg border border-dark-700 bg-dark-950 px-3 py-1.5 text-sm text-dark-200 transition-colors hover:border-dark-500 hover:text-dark-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={confirmAction}
								className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${actionConfirmButtonClass}`}
							>
								{resolvedActionConfirmLabel}
							</button>
						</div>
					</div>
				</div>
			)}

			{menuPosition && (
				<div
					ref={menuRef}
					className="fixed z-50 min-w-[10rem] overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg"
					style={{
						left: menuPosition.x,
						top: menuPosition.y,
					}}
				>
					<button
						type="button"
						onClick={startInlineRename}
						className="block w-full px-3 py-2 text-left text-sm text-dark-300 transition-colors hover:bg-dark-800/70 hover:text-dark-100"
					>
						Rename
					</button>
					<button
						type="button"
						onClick={handleAction}
						className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-dark-800/70 ${actionTextClass}`}
					>
						{actionLabel}
					</button>
				</div>
			)}
		</div>
	);
}
