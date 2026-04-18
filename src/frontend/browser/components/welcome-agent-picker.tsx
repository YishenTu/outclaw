import { useEffect, useRef, useState } from "react";
import type { AgentEntry } from "../stores/agents.ts";

interface WelcomeAgentPickerViewProps {
	agents: AgentEntry[];
	menuOpen: boolean;
	onAgentChange: (agentId: string) => void;
	onToggleMenu?: () => void;
	selectedAgentId: string | null;
}

function resolveSelectedAgentName(
	agents: AgentEntry[],
	selectedAgentId: string | null,
): string {
	return (
		agents.find((agent) => agent.agentId === selectedAgentId)?.name ??
		"No agents available"
	);
}

export function WelcomeAgentPickerView({
	agents,
	menuOpen,
	onAgentChange,
	onToggleMenu,
	selectedAgentId,
}: WelcomeAgentPickerViewProps) {
	const selectedAgentName = resolveSelectedAgentName(agents, selectedAgentId);
	const disabled = agents.length === 0;

	return (
		<div className="relative inline-flex items-center gap-2">
			<span className="font-mono-ui text-[10px] uppercase tracking-[0.22em] text-dark-500">
				To
			</span>
			<button
				type="button"
				aria-label="Choose agent"
				aria-expanded={menuOpen}
				disabled={disabled}
				onClick={onToggleMenu}
				className="group inline-flex items-center rounded px-1 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
			>
				<span className="font-mono-ui text-[12px] uppercase tracking-[0.22em] text-parchment group-hover:text-ember">
					{disabled ? selectedAgentName : `@${selectedAgentName}`}
				</span>
			</button>
			{menuOpen && agents.length > 0 && (
				<div className="absolute bottom-full left-0 z-30 mb-1 min-w-[10rem] overflow-hidden rounded-md border border-dark-700 bg-dark-900 shadow-lg">
					{agents.map((agent) => {
						const active = agent.agentId === selectedAgentId;
						return (
							<button
								key={agent.agentId}
								type="button"
								onMouseDown={(event) => {
									event.preventDefault();
									onAgentChange(agent.agentId);
								}}
								className={`block w-full px-3 py-1.5 text-left transition-colors ${
									active
										? "bg-dark-800 text-parchment"
										: "text-dark-300 hover:bg-dark-800/70"
								}`}
							>
								<span className="font-mono-ui text-[12px] uppercase tracking-[0.18em]">
									@{agent.name}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

interface WelcomeAgentPickerProps {
	agents: AgentEntry[];
	onAgentChange: (agentId: string) => void;
	selectedAgentId: string | null;
}

export function WelcomeAgentPicker({
	agents,
	onAgentChange,
	selectedAgentId,
}: WelcomeAgentPickerProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!menuOpen) {
			return;
		}

		function handlePointerDown(event: MouseEvent) {
			if (rootRef.current?.contains(event.target as Node)) {
				return;
			}

			setMenuOpen(false);
		}

		document.addEventListener("mousedown", handlePointerDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
		};
	}, [menuOpen]);

	return (
		<div ref={rootRef}>
			<WelcomeAgentPickerView
				agents={agents}
				menuOpen={menuOpen}
				onAgentChange={(agentId) => {
					onAgentChange(agentId);
					setMenuOpen(false);
				}}
				onToggleMenu={() => {
					if (agents.length === 0) {
						return;
					}

					setMenuOpen((current) => !current);
				}}
				selectedAgentId={selectedAgentId}
			/>
		</div>
	);
}
