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
				dotClassName: "bg-emerald-400",
				label: "Runtime connected",
			};
		case "disconnected":
			return {
				dotClassName: "bg-red-300",
				label: "Runtime offline",
			};
		case "connecting":
			return {
				dotClassName: "bg-amber-300",
				label: "Runtime connecting",
			};
	}
}

export function SidebarRuntimeStatus() {
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);
	const error = useRuntimeStore((state) => state.error);
	const presentation = describeRuntimeConnectionStatus(connectionStatus);

	return (
		<div className="border-t border-dark-800 px-4 py-3">
			<div
				title={error ?? presentation.label}
				className="flex items-center gap-2"
			>
				<span
					aria-hidden="true"
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dotClassName}`}
				/>
				<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
					{presentation.label}
				</span>
			</div>
		</div>
	);
}
