import { useEffect } from "react";
import type { BrowserRuntimePopup } from "../../stores/runtime-popup.ts";

export interface RuntimePopupKeyEvent {
	key?: string;
	shiftKey?: boolean;
	preventDefault: () => void;
	stopPropagation: () => void;
}

interface RuntimePopupShortcutHandlers {
	selectedIndex: number;
	setSelectedIndex: (index: number) => void;
	selectIndex: (index: number) => void;
	closePopup: () => void;
	onDismiss?: () => void;
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

function getRuntimePopupItemCount(popup: BrowserRuntimePopup): number {
	switch (popup.kind) {
		case "agent":
			return popup.agents.length;
		case "session":
			return popup.sessions.length;
		case "status":
			return 0;
	}
}

export function handleRuntimePopupKeydown(
	event: RuntimePopupKeyEvent,
	popup: BrowserRuntimePopup | null,
	handlers: RuntimePopupShortcutHandlers,
): boolean {
	if (!popup) {
		return false;
	}

	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		handlers.closePopup();
		handlers.onDismiss?.();
		return true;
	}

	if (popup.kind === "status") {
		return false;
	}

	const itemCount = getRuntimePopupItemCount(popup);
	if (itemCount === 0) {
		return false;
	}

	const currentIndex = Math.min(
		Math.max(handlers.selectedIndex, 0),
		itemCount - 1,
	);

	if (event.key === "ArrowDown") {
		event.preventDefault();
		event.stopPropagation();
		handlers.setSelectedIndex(Math.min(currentIndex + 1, itemCount - 1));
		return true;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		event.stopPropagation();
		handlers.setSelectedIndex(Math.max(currentIndex - 1, 0));
		return true;
	}

	if (
		(event.key === "Enter" || event.key === "Tab") &&
		event.shiftKey !== true
	) {
		event.preventDefault();
		event.stopPropagation();
		handlers.selectIndex(currentIndex);
		return true;
	}

	return false;
}

export function registerRuntimePopupShortcuts(
	target: RuntimePopupShortcutTarget,
	popup: BrowserRuntimePopup | null,
	handlers: RuntimePopupShortcutHandlers,
): () => void {
	if (!popup) {
		return () => {};
	}

	const listener: EventListener = (event) => {
		handleRuntimePopupKeydown(
			event as Event & RuntimePopupKeyEvent,
			popup,
			handlers,
		);
	};

	target.addEventListener("keydown", listener, true);

	return () => {
		target.removeEventListener("keydown", listener, true);
	};
}

export function useRuntimePopupShortcuts(
	popup: BrowserRuntimePopup | null,
	handlers: RuntimePopupShortcutHandlers,
) {
	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		return registerRuntimePopupShortcuts(window, popup, handlers);
	}, [popup, handlers]);
}
