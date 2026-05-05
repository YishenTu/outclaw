import { RotateCcw, Settings2 } from "lucide-react";
import type {
	BrowserConnectionStatus,
	BrowserRuntimeLatency,
} from "../../stores/runtime.ts";
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

export function formatRuntimeLatencyLabel(
	connectionStatus: BrowserConnectionStatus,
	latency: BrowserRuntimeLatency,
): string | null {
	if (connectionStatus !== "connected") {
		return null;
	}

	if (latency.status === "ready") {
		return `RTT ${latency.rttMs}ms`;
	}
	if (latency.status === "measuring") {
		return latency.rttMs === null ? "RTT ..." : `RTT ${latency.rttMs}ms`;
	}
	if (latency.status === "timeout") {
		return "RTT timeout";
	}
	if (latency.status === "error") {
		return "RTT --";
	}
	return "RTT --";
}

interface SidebarRuntimeStatusProps {
	configOpen?: boolean;
	onToggleConfig?: () => void;
	onRestart?: () => void;
}

interface SidebarRuntimeStatusViewProps extends SidebarRuntimeStatusProps {
	connectionStatus: BrowserConnectionStatus;
	error: string | null;
	latency: BrowserRuntimeLatency;
}

export function SidebarRuntimeStatusView({
	configOpen = false,
	connectionStatus,
	error,
	latency,
	onToggleConfig = () => {},
	onRestart = () => {},
}: SidebarRuntimeStatusViewProps) {
	const presentation = describeRuntimeConnectionStatus(connectionStatus);
	const latencyLabel = formatRuntimeLatencyLabel(connectionStatus, latency);
	const statusLabel = latencyLabel
		? `${presentation.label} · ${latencyLabel}`
		: presentation.label;

	return (
		<div className="border-t border-dark-800 px-4 py-3">
			<div className="flex items-center justify-between gap-3">
				<div
					title={error ?? statusLabel}
					className="flex min-w-0 items-center gap-2"
				>
					<span
						aria-hidden="true"
						className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dotClassName}`}
					/>
					<span className="truncate font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						{statusLabel}
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

export function SidebarRuntimeStatus(props: SidebarRuntimeStatusProps) {
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);
	const error = useRuntimeStore((state) => state.error);
	const latency = useRuntimeStore((state) => state.latency);

	return (
		<SidebarRuntimeStatusView
			{...props}
			connectionStatus={connectionStatus}
			error={error}
			latency={latency}
		/>
	);
}
