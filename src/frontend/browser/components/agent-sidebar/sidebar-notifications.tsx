import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRuntimeStore } from "../../stores/runtime.ts";
import { useRuntimePopupStore } from "../../stores/runtime-popup.ts";
import {
	resolveConnectionToast,
	shouldShowConnectionToast,
} from "../connection-toast.tsx";

type NotificationTone = "danger" | "warning" | "info";
type NotificationIconVariant = "alert" | "spinner" | "dot";

interface NotificationItem {
	key: string;
	tone: NotificationTone;
	icon: NotificationIconVariant;
	title: string;
	detail?: string;
	onDismiss?: () => void;
}

interface ToneClasses {
	container: string;
	icon: string;
	title: string;
	detail: string;
	dismiss: string;
}

const TONE_CLASS: Record<NotificationTone, ToneClasses> = {
	danger: {
		container: "border-danger/30 bg-danger/10",
		icon: "text-danger",
		title: "text-danger",
		detail: "text-danger/80",
		dismiss: "text-danger/70 hover:text-danger",
	},
	warning: {
		container: "border-warning/30 bg-warning/10",
		icon: "text-warning",
		title: "text-warning",
		detail: "text-warning/80",
		dismiss: "text-warning/70 hover:text-warning",
	},
	info: {
		container: "border-dark-800 bg-dark-900/50",
		icon: "text-info",
		title: "text-dark-100",
		detail: "text-dark-400",
		dismiss: "text-dark-500 hover:text-dark-100",
	},
};

function splitStatusText(text: string): { title: string; body: string } {
	const [firstLine = "Status", ...rest] = text.split("\n");
	return { title: firstLine, body: rest.join("\n") };
}

export function SidebarNotifications() {
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);
	const runtimeError = useRuntimeStore((state) => state.error);
	const notice = useRuntimeStore((state) => state.notice);
	const popup = useRuntimePopupStore((state) => state.popup);

	const [hasConnectedOnce, setHasConnectedOnce] = useState(false);
	useEffect(() => {
		if (connectionStatus === "connected") {
			setHasConnectedOnce(true);
		}
	}, [connectionStatus]);

	const items: NotificationItem[] = [];

	if (shouldShowConnectionToast(connectionStatus, hasConnectedOnce)) {
		const toast = resolveConnectionToast(connectionStatus, runtimeError);
		items.push({
			key: "connection",
			tone: "danger",
			icon: connectionStatus === "disconnected" ? "alert" : "spinner",
			title: toast.title,
			detail: toast.detail,
		});
	}

	if (notice?.kind === "restart_required") {
		items.push({
			key: "notice-restart",
			tone: "warning",
			icon: "alert",
			title: "Restart required",
			detail: "Changes won't update until the runtime restarts.",
		});
	} else if (notice?.kind === "rollover") {
		items.push({
			key: "notice-rollover",
			tone: "warning",
			icon: "alert",
			title: "Session rollover",
			detail: notice.message,
		});
	}

	if (popup?.kind === "status") {
		const { title, body } = splitStatusText(popup.text);
		const inProgress = title.endsWith("...");
		items.push({
			key: "status",
			tone: "info",
			icon: inProgress ? "spinner" : "dot",
			title,
			detail: body.length > 0 ? body : undefined,
		});
	}

	if (items.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-1.5 bg-dark-950 px-3 py-2.5">
			{items.map((item) => (
				<NotificationCard key={item.key} item={item} />
			))}
		</div>
	);
}

function NotificationCard({ item }: { item: NotificationItem }) {
	const tone = TONE_CLASS[item.tone];
	return (
		<div className={`rounded-lg border px-3 py-2 ${tone.container}`}>
			<div className="flex items-start gap-2">
				<NotificationIcon variant={item.icon} toneClass={tone.icon} />
				<div className="min-w-0 flex-1 leading-tight">
					<div className={`text-[12px] font-medium ${tone.title}`}>
						{item.title}
					</div>
					{item.detail ? (
						<div
							className={`mt-1 whitespace-pre-wrap break-words text-[11px] ${tone.detail}`}
						>
							{item.detail}
						</div>
					) : null}
				</div>
				{item.onDismiss ? (
					<button
						type="button"
						onClick={item.onDismiss}
						aria-label="Dismiss notification"
						className={`shrink-0 transition-colors ${tone.dismiss}`}
					>
						<X size={12} />
					</button>
				) : null}
			</div>
		</div>
	);
}

function NotificationIcon({
	variant,
	toneClass,
}: {
	variant: NotificationIconVariant;
	toneClass: string;
}) {
	if (variant === "spinner") {
		return (
			<LoaderCircle
				size={12}
				className={`mt-0.5 shrink-0 animate-spin ${toneClass}`}
				aria-hidden="true"
			/>
		);
	}
	if (variant === "alert") {
		return (
			<AlertCircle
				size={12}
				className={`mt-0.5 shrink-0 ${toneClass}`}
				aria-hidden="true"
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current ${toneClass}`}
		/>
	);
}
