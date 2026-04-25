import { useEffect, useRef } from "react";

export interface GlobalStopKeyEvent {
	defaultPrevented?: boolean;
	key?: string;
	target?: unknown;
	preventDefault: () => void;
}

interface GlobalStopShortcutTarget {
	addEventListener: (type: "keydown", listener: EventListener) => void;
	removeEventListener: (type: "keydown", listener: EventListener) => void;
}

interface ElementLike {
	isContentEditable?: boolean;
	tagName?: string;
	type?: string;
	closest?: (selector: string) => unknown;
}

const NON_EDITABLE_INPUT_TYPES = new Set([
	"button",
	"checkbox",
	"color",
	"file",
	"image",
	"radio",
	"range",
	"reset",
	"submit",
]);

function isElementLike(target: unknown): target is ElementLike {
	return typeof target === "object" && target !== null;
}

function hasClosest(target: ElementLike): target is ElementLike & {
	closest: (selector: string) => unknown;
} {
	return typeof target.closest === "function";
}

function isEditableTarget(target: unknown): boolean {
	if (!isElementLike(target)) {
		return false;
	}

	if (target.isContentEditable === true) {
		return true;
	}

	const tagName = target.tagName?.toLowerCase();
	if (tagName === "textarea" || tagName === "select") {
		return true;
	}

	if (tagName !== "input") {
		return false;
	}

	const inputType = target.type?.toLowerCase() ?? "text";
	return !NON_EDITABLE_INPUT_TYPES.has(inputType);
}

function isInsideDialog(target: unknown): boolean {
	if (!isElementLike(target) || !hasClosest(target)) {
		return false;
	}

	return target.closest('[role="dialog"], [aria-modal="true"]') !== null;
}

function shouldIgnoreGlobalStop(event: GlobalStopKeyEvent): boolean {
	return (
		event.defaultPrevented === true ||
		isEditableTarget(event.target) ||
		isInsideDialog(event.target)
	);
}

export function handleGlobalStopKeydown(
	event: GlobalStopKeyEvent,
	enabled: boolean,
	sendStopCommand: () => boolean,
): boolean {
	if (!enabled || event.key !== "Escape" || shouldIgnoreGlobalStop(event)) {
		return false;
	}

	if (!sendStopCommand()) {
		return false;
	}

	event.preventDefault();
	return true;
}

export function registerGlobalStopShortcut(
	target: GlobalStopShortcutTarget,
	enabled: boolean,
	sendStopCommand: () => boolean,
): () => void {
	if (!enabled) {
		return () => {};
	}

	const listener: EventListener = (event) => {
		handleGlobalStopKeydown(
			event as Event & GlobalStopKeyEvent,
			enabled,
			sendStopCommand,
		);
	};

	target.addEventListener("keydown", listener);

	return () => {
		target.removeEventListener("keydown", listener);
	};
}

export function useGlobalStopShortcut(
	enabled: boolean,
	sendStopCommand: () => boolean,
) {
	const sendStopCommandRef = useRef(sendStopCommand);

	useEffect(() => {
		sendStopCommandRef.current = sendStopCommand;
	}, [sendStopCommand]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		return registerGlobalStopShortcut(window, enabled, () =>
			sendStopCommandRef.current(),
		);
	}, [enabled]);
}
