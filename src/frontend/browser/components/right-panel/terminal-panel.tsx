import { TerminalSquare } from "lucide-react";
import { useEffect } from "react";
import {
	selectActiveTerminalId,
	selectAgentTerminals,
	useTerminalStore,
} from "../../stores/terminal.ts";
import { TerminalView } from "./terminal-view.tsx";

interface TerminalPanelProps {
	agentId: string | null;
	active: boolean;
}

export function TerminalPanel({ agentId, active }: TerminalPanelProps) {
	const terminals = useTerminalStore((state) =>
		selectAgentTerminals(state, agentId),
	);
	const activeTerminalId = useTerminalStore((state) =>
		selectActiveTerminalId(state, agentId),
	);
	const ensureTerminal = useTerminalStore((state) => state.ensureTerminal);

	useEffect(() => {
		if (!agentId) {
			return;
		}

		ensureTerminal(agentId);
	}, [agentId, ensureTerminal]);

	if (!agentId) {
		return (
			<div className="flex h-full flex-1 items-center justify-center bg-dark-950">
				<div className="text-center text-dark-500">
					<TerminalSquare size={28} className="mx-auto mb-3 opacity-60" />
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.14em]">
						No active agent
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-dark-950">
			{terminals.map((terminal) => (
				<TerminalView
					key={terminal.id}
					active={active && terminal.id === activeTerminalId}
					agentId={agentId}
					terminalId={terminal.id}
				/>
			))}
		</div>
	);
}
