import { useEffect, useRef } from "react";
import type { BrowserRuntimePopup } from "../../stores/runtime-popup.ts";
import { formatLastActive } from "../agent-sidebar/format-last-active.ts";

interface RuntimeCommandPopupProps {
	popup: BrowserRuntimePopup;
	selectedIndex: number;
	onSelect: (index: number) => void;
}

function itemCount(popup: BrowserRuntimePopup): number {
	switch (popup.kind) {
		case "agent":
			return popup.agents.length;
		case "session":
			return popup.sessions.length;
		case "status":
			return 0;
	}
}

export function RuntimeCommandPopup({
	popup,
	selectedIndex,
	onSelect,
}: RuntimeCommandPopupProps) {
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const list = listRef.current;
		if (!list || popup.kind === "status") {
			return;
		}

		const selectedItem = list.children[selectedIndex];
		if (!(selectedItem instanceof HTMLElement)) {
			return;
		}

		selectedItem.scrollIntoView({ block: "nearest" });
	}, [popup, selectedIndex]);

	if (popup.kind === "status") {
		return (
			<div className="absolute bottom-full left-1/2 mb-2 w-4/5 max-w-full -translate-x-1/2 overflow-hidden rounded-[18px] border border-dark-800 bg-dark-900 shadow-lg">
				<pre className="font-mono-ui whitespace-pre-wrap px-3 py-3 text-xs leading-6 text-dark-200">
					{popup.text}
				</pre>
			</div>
		);
	}

	const count = itemCount(popup);
	const title = popup.kind === "agent" ? "Agents" : "Sessions";
	const emptyMessage =
		popup.kind === "agent"
			? "No agents available."
			: "No saved sessions available.";

	return (
		<div className="absolute bottom-full left-1/2 mb-2 w-4/5 max-w-full -translate-x-1/2 overflow-hidden rounded-[18px] border border-dark-800 bg-dark-900 shadow-lg">
			<div className="border-b border-dark-800 px-3 py-2 text-xs uppercase tracking-[0.14em] text-dark-500">
				{title}
			</div>
			{count === 0 ? (
				<div className="px-3 py-3 text-sm text-dark-400">{emptyMessage}</div>
			) : (
				<div ref={listRef} className="scrollbar-none max-h-64 overflow-y-auto">
					{popup.kind === "agent"
						? popup.agents.map((agent, index) => {
								const active = index === selectedIndex;
								const currentAgent = agent.agentId === popup.activeAgentId;
								return (
									<button
										key={agent.agentId}
										type="button"
										onMouseDown={(event) => {
											event.preventDefault();
											onSelect(index);
										}}
										className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
											active
												? "bg-dark-800 text-dark-100"
												: "text-dark-300 hover:bg-dark-800/70"
										}`}
									>
										<span className="flex w-4 shrink-0 justify-center text-dark-400">
											{currentAgent ? "●" : ""}
										</span>
										<span className="min-w-0 flex-1 truncate">
											{agent.name}
										</span>
									</button>
								);
							})
						: popup.sessions.map((session, index) => {
								const active = index === selectedIndex;
								const currentSession =
									session.sdkSessionId === popup.activeSessionId;
								return (
									<button
										key={session.sdkSessionId}
										type="button"
										onMouseDown={(event) => {
											event.preventDefault();
											onSelect(index);
										}}
										className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
											active
												? "bg-dark-800 text-dark-100"
												: "text-dark-300 hover:bg-dark-800/70"
										}`}
									>
										<span className="flex w-4 shrink-0 justify-center text-dark-400">
											{currentSession ? "●" : ""}
										</span>
										<span className="min-w-0 flex-1 truncate">
											{session.title}
										</span>
										<span className="font-mono-ui shrink-0 text-[10px] uppercase tracking-[0.12em] text-dark-500">
											{formatLastActive(session.lastActive)}
										</span>
									</button>
								);
							})}
				</div>
			)}
		</div>
	);
}
