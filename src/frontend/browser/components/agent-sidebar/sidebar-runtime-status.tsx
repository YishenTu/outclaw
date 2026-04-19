import { RotateCcw, Settings2 } from "lucide-react";
import type { BrowserConnectionStatus } from "../../stores/runtime.ts";
import { useRuntimeStore } from "../../stores/runtime.ts";

interface RuntimeConnectionPresentation {
	dotClassName: string;
	label: string;
}

export function describeRuntimeConnectionStatus(
	status: BrowserConnectionStatus,
): RuntimeConnectionPresentation {
	switch (status) {
		case "connected":
			return {
				dotClassName: "bg-success",
				label: "Connected",
			};
		case "disconnected":
			return {
				dotClassName: "bg-danger",
				label: "Offline",
			};
		case "connecting":
			return {
				dotClassName: "bg-warning",
				label: "Connecting",
			};
	}
}

interface SidebarRuntimeStatusProps {
	configOpen?: boolean;
	onToggleConfig?: () => void;
	onRestart?: () => void;
}

export function SidebarRuntimeStatus({
	configOpen = false,
	onToggleConfig = () => {},
	onRestart = () => {},
}: SidebarRuntimeStatusProps) {
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);
	const error = useRuntimeStore((state) => state.error);
	const presentation = describeRuntimeConnectionStatus(connectionStatus);

	return (
		<div className="border-t border-dark-800 px-4 py-3">
			<div className="flex items-center justify-between gap-3">
				<div
					title={error ?? presentation.label}
					className="flex min-w-0 items-center gap-2"
				>
					<span
						aria-hidden="true"
						className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dotClassName}`}
					/>
					<span className="truncate font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						{presentation.label}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onToggleConfig}
						title={configOpen ? "Close config" : "Config"}
						aria-label={configOpen ? "Close config panel" : "Open config panel"}
						aria-pressed={configOpen}
						className={`inline-flex shrink-0 items-center transition-colors ${
							configOpen ? "text-dark-50" : "text-dark-500 hover:text-dark-100"
						}`}
					>
						<Settings2 size={12} />
					</button>
					<button
						type="button"
						onClick={onRestart}
						title="Restart"
						aria-label="Restart runtime"
						className="inline-flex shrink-0 items-center text-dark-500 transition-colors hover:text-dark-100"
					>
						<RotateCcw size={12} />
					</button>
				</div>
			</div>
		</div>
	);
}
