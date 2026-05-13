import { Code2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BrowserCodingSessionSummary } from "../../../common/protocol.ts";
import {
	listLinkedCodingSessionsForActiveChat,
	openLinkedCodingSession,
} from "./linked-coding-session-actions.ts";

interface LinkedCodingSessionMenuButtonViewProps {
	open: boolean;
	loading: boolean;
	sessions: BrowserCodingSessionSummary[];
	onToggle: () => void;
	onSelect: (session: BrowserCodingSessionSummary) => void;
}

export function LinkedCodingSessionMenuButton() {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [sessions, setSessions] = useState<BrowserCodingSessionSummary[]>([]);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const loadSequenceRef = useRef(0);

	useEffect(() => {
		if (!open) {
			return;
		}

		function closeMenu() {
			loadSequenceRef.current += 1;
			setOpen(false);
			setLoading(false);
		}

		function handlePointerDown(event: MouseEvent) {
			if (rootRef.current?.contains(event.target as Node)) {
				return;
			}
			closeMenu();
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				closeMenu();
			}
		}

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		window.addEventListener("blur", closeMenu);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("blur", closeMenu);
		};
	}, [open]);

	async function openMenu() {
		const loadSequence = loadSequenceRef.current + 1;
		loadSequenceRef.current = loadSequence;
		setOpen(true);
		setLoading(true);
		const nextSessions = await listLinkedCodingSessionsForActiveChat({
			showEmptyStatus: false,
			showLookupErrorStatus: true,
		});
		if (loadSequenceRef.current !== loadSequence) {
			return;
		}
		setSessions(nextSessions);
		setLoading(false);
	}

	function closeMenu() {
		loadSequenceRef.current += 1;
		setOpen(false);
		setLoading(false);
	}

	function handleToggle() {
		if (open) {
			closeMenu();
			return;
		}
		void openMenu();
	}

	function handleSelect(session: BrowserCodingSessionSummary) {
		if (openLinkedCodingSession(session)) {
			closeMenu();
		}
	}

	return (
		<div ref={rootRef} className="relative ml-auto">
			<LinkedCodingSessionMenuButtonView
				open={open}
				loading={loading}
				sessions={sessions}
				onToggle={handleToggle}
				onSelect={handleSelect}
			/>
		</div>
	);
}

export function LinkedCodingSessionMenuButtonView({
	open,
	loading,
	sessions,
	onToggle,
	onSelect,
}: LinkedCodingSessionMenuButtonViewProps) {
	return (
		<>
			<button
				type="button"
				title="Open linked coding sessions"
				aria-label="Open linked coding sessions"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={onToggle}
				className="inline-flex h-6 w-6 items-center justify-center text-dark-400 transition-colors hover:text-parchment focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-dark-500"
			>
				<Code2 size={14} />
			</button>
			{open && (
				<div
					role="menu"
					aria-label="Linked coding sessions"
					className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-[16px] border border-dark-800 bg-dark-900 shadow-lg"
				>
					{loading ? (
						<div className="px-3 py-3 text-sm text-dark-400">
							Loading coding sessions...
						</div>
					) : sessions.length === 0 ? (
						<div className="px-3 py-3 text-sm text-dark-400">
							No linked coding sessions.
						</div>
					) : (
						sessions.map((session) => (
							<button
								key={`${session.providerId}:${session.sdkSessionId}`}
								type="button"
								role="menuitem"
								onClick={() => onSelect(session)}
								className="flex w-full min-w-0 flex-col gap-1 px-3 py-2 text-left text-sm text-dark-300 transition-colors hover:bg-dark-800/70 hover:text-dark-100"
							>
								<span className="w-full truncate text-dark-100">
									{session.title || session.sdkSessionId}
								</span>
								<span className="font-mono-ui w-full truncate text-[11px] text-dark-500">
									{formatRunStatus(session.runStatus)}
									<span className="px-1.5 text-dark-700">/</span>
									{session.cwd}
								</span>
							</button>
						))
					)}
				</div>
			)}
		</>
	);
}

function formatRunStatus(status: BrowserCodingSessionSummary["runStatus"]) {
	switch (status) {
		case "running":
			return "Running";
		case "failed":
			return "Failed";
		case "idle":
			return "Idle";
	}
}
