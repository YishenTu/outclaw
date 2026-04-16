import { useEffect } from "react";
import type { BrowserRuntimePopup } from "../../stores/runtime-popup.ts";

export interface RuntimePopupKeyEvent {
	key?: string;
	preventDefault: () => void;
	stopPropagation: () => void;
}

interface RuntimePopupShortcutTarget {
	addEventListener: (
		type: "keydown",
		listener: EventListener,
		options?: boolean,
	) => void;
	removeEventListener: (
		type: "keydown",
		listener: EventListener,
		options?: boolean,
	) => void;
}

export function handleRuntimePopupKeydown(
	event: RuntimePopupKeyEvent,
	popup: BrowserRuntimePopup | null,
	closePopup: () => void,
	onDismiss?: () => void,
): boolean {
	if (!popup || event.key !== "Escape") {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	closePopup();
	onDismiss?.();
	return true;
}

export function registerRuntimePopupShortcuts(
	target: RuntimePopupShortcutTarget,
	popup: BrowserRuntimePopup | null,
	closePopup: () => void,
	onDismiss?: () => void,
): () => void {
	if (!popup) {
		return () => {};
	}

	const listener: EventListener = (event) => {
		handleRuntimePopupKeydown(
			event as Event & RuntimePopupKeyEvent,
			popup,
			closePopup,
			onDismiss,
		);
	};

	target.addEventListener("keydown", listener, true);

	return () => {
		target.removeEventListener("keydown", listener, true);
	};
}

export function useRuntimePopupShortcuts(
	popup: BrowserRuntimePopup | null,
	closePopup: () => void,
	onDismiss?: () => void,
) {
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		return registerRuntimePopupShortcuts(window, popup, closePopup, onDismiss);
	}, [popup, closePopup, onDismiss]);
}
