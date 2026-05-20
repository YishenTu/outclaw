import type {
	TerminalAttachedEvent,
	TerminalClosedEvent,
	TerminalErrorEvent,
	TerminalOutputEvent,
} from "../../../../../common/protocol.ts";

export type BrowserTerminalRuntimeEvent =
	| TerminalAttachedEvent
	| TerminalClosedEvent
	| TerminalErrorEvent
	| TerminalOutputEvent;

const terminalEventListeners = new Map<
	string,
	Set<(event: BrowserTerminalRuntimeEvent) => void>
>();

export function subscribeTerminalRuntimeEvents(
	terminalId: string,
	listener: (event: BrowserTerminalRuntimeEvent) => void,
): () => void {
	let listeners = terminalEventListeners.get(terminalId);
	if (!listeners) {
		listeners = new Set();
		terminalEventListeners.set(terminalId, listeners);
	}
	listeners.add(listener);
	return () => {
		const current = terminalEventListeners.get(terminalId);
		if (!current) {
			return;
		}
		current.delete(listener);
		if (current.size === 0) {
			terminalEventListeners.delete(terminalId);
		}
	};
}

export function publishTerminalRuntimeEvent(
	event: BrowserTerminalRuntimeEvent,
): void {
	for (const listener of [
		...(terminalEventListeners.get(event.terminalId ?? "") ?? []),
	]) {
		listener(event);
	}
}
