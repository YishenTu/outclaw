import { useEffect, useRef, useState } from "react";
import type { SessionEntry } from "../../stores/sessions.ts";
import { formatLastActive } from "./format-last-active.ts";

interface SessionItemProps {
	session: SessionEntry;
	isActive: boolean;
	onSelect: () => void;
	onRename: (title: string) => void;
	onDelete: () => void;
}

export function SessionItem({
	session,
	isActive,
	onSelect,
	onRename,
	onDelete,
}: SessionItemProps) {
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const [draftTitle, setDraftTitle] = useState(session.title);
	const [editing, setEditing] = useState(false);
	const [menuPosition, setMenuPosition] = useState<{
		x: number;
		y: number;
	} | null>(null);

	function startInlineRename() {
		setDraftTitle(session.title);
		setEditing(true);
		setMenuPosition(null);
	}

	function finishInlineRename(commit: boolean) {
		if (commit) {
			const nextTitle = draftTitle.trim();
			if (nextTitle !== "" && nextTitle !== session.title) {
				onRename(nextTitle);
			}
		}

		setEditing(false);
		setDraftTitle(session.title);
	}

	function handleDelete() {
		if (window.confirm(`Delete session "${session.title}"?`)) {
			onDelete();
		}
		setMenuPosition(null);
	}

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

		setDraftTitle(session.title);
	}, [editing, session.title]);

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
								{session.title}
							</div>
						</div>
					</button>
					<div className="absolute inset-y-0 right-2 flex items-center">
						<div className="font-mono-ui w-8 shrink-0 text-right text-[10px] uppercase tracking-[0.12em] text-dark-500 group-hover:hidden">
							{formatLastActive(session.lastActive)}
						</div>
						<button
							type="button"
							aria-label={`Delete session ${session.title}`}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								handleDelete();
							}}
							className="font-mono-ui hidden w-8 shrink-0 text-right text-[18px] leading-none text-dark-500 transition-colors hover:text-red-300 group-hover:block"
						>
							×
						</button>
					</div>
				</>
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
						onClick={handleDelete}
						className="block w-full px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-dark-800/70"
					>
						Delete
					</button>
				</div>
			)}
		</div>
	);
}
