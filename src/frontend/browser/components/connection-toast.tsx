import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { BrowserConnectionStatus } from "../stores/runtime.ts";
import { useRuntimeStore } from "../stores/runtime.ts";

export interface ConnectionToastContent {
	detail: string;
	title: string;
}

export function shouldShowConnectionToast(
	connectionStatus: BrowserConnectionStatus,
	hasConnectedOnce: boolean,
): boolean {
	return hasConnectedOnce && connectionStatus !== "connected";
}

export function resolveConnectionToast(
	connectionStatus: BrowserConnectionStatus,
	runtimeError: string | null,
): ConnectionToastContent {
	if (connectionStatus === "disconnected") {
		return {
			title: "Runtime disconnected",
			detail: runtimeError ?? "Connection to the daemon was lost.",
		};
	}

	return {
		title: "Reconnecting to runtime",
		detail: "Trying to reconnect to the daemon.",
	};
}

export function ConnectionToast() {
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);
	const runtimeError = useRuntimeStore((state) => state.error);
	const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

	useEffect(() => {
		if (connectionStatus === "connected") {
			setHasConnectedOnce(true);
		}
	}, [connectionStatus]);

	if (!shouldShowConnectionToast(connectionStatus, hasConnectedOnce)) {
		return null;
	}

	const toast = resolveConnectionToast(connectionStatus, runtimeError);
	const isDisconnected = connectionStatus === "disconnected";

	return (
		<div className="pointer-events-none fixed bottom-4 right-4 z-50">
			<div className="flex max-w-sm items-start gap-3 rounded-[18px] border border-dark-800 bg-dark-900/95 px-4 py-3 shadow-lg backdrop-blur">
				<div className="pt-0.5 text-dark-300">
					{isDisconnected ? (
						<AlertCircle size={16} />
					) : (
						<LoaderCircle size={16} className="animate-spin" />
					)}
				</div>
				<div className="min-w-0">
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-200">
						{toast.title}
					</div>
					<div className="mt-1 text-sm leading-6 text-dark-400">
						{toast.detail}
					</div>
				</div>
			</div>
		</div>
	);
}
