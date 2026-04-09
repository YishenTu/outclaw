import type { ReadStream } from "node:tty";
import type { Key } from "ink";
import { useStdin } from "ink";
import { useEffect } from "react";
import {
	createTerminalInputParser,
	nonAlphanumericKeys,
	type ParsedTerminalKeypress,
	parseTerminalKeypress,
} from "./terminal-input-parser.ts";

type ManagedStdin = NodeJS.ReadStream &
	Partial<
		Pick<ReadStream, "isTTY" | "ref" | "setEncoding" | "setRawMode" | "unref">
	>;

export interface TextAreaInputEvent {
	input: string;
	key: Key;
	sequence: string;
}

function killCurrentProcess(stdin: ManagedStdin) {
	stdin.setRawMode?.(false);
	process.kill(process.pid, "SIGINT");
}

class TerminalInputManager {
	private readonly parser = createTerminalInputParser();
	private readonly subscribers = new Set<(event: TextAreaInputEvent) => void>();
	private flushTimer: ReturnType<typeof setImmediate> | undefined;
	private attached = false;

	constructor(private readonly stdin: ManagedStdin) {}

	subscribe(handler: (event: TextAreaInputEvent) => void): () => void {
		this.subscribers.add(handler);
		if (!this.attached) {
			this.attach();
		}

		return () => {
			this.subscribers.delete(handler);
			if (this.subscribers.size === 0) {
				this.detach();
			}
		};
	}

	private attach() {
		if (this.attached) {
			return;
		}

		this.stdin.setEncoding?.("utf8");
		this.stdin.ref?.();
		this.stdin.setRawMode?.(true);
		this.stdin.addListener("readable", this.handleReadable);
		this.attached = true;
	}

	private detach() {
		if (!this.attached) {
			return;
		}

		if (this.flushTimer !== undefined) {
			clearImmediate(this.flushTimer);
			this.flushTimer = undefined;
		}
		this.parser.reset();
		this.stdin.removeListener("readable", this.handleReadable);
		this.stdin.setRawMode?.(false);
		this.stdin.unref?.();
		this.attached = false;
	}

	private emit(sequence: string) {
		const event = normalizeTextAreaInput(sequence);
		if (event.input === "c" && event.key.ctrl) {
			killCurrentProcess(this.stdin);
			return;
		}
		for (const subscriber of this.subscribers) {
			subscriber(event);
		}
	}

	private scheduleFlush() {
		if (this.flushTimer !== undefined) {
			clearImmediate(this.flushTimer);
		}
		this.flushTimer = setImmediate(() => {
			this.flushTimer = undefined;
			const pendingEscape = this.parser.flushPendingEscape();
			if (!pendingEscape) {
				return;
			}
			this.emit(pendingEscape);
		});
	}

	private readonly handleReadable = () => {
		if (this.flushTimer !== undefined) {
			clearImmediate(this.flushTimer);
			this.flushTimer = undefined;
		}

		for (;;) {
			const chunk = this.stdin.read() as string | Buffer | null;
			if (chunk === null) {
				break;
			}
			for (const sequence of this.parser.push(chunk)) {
				this.emit(sequence);
			}
		}

		if (this.parser.hasPendingEscape()) {
			this.scheduleFlush();
		}
	};
}

const inputManagers = new WeakMap<ManagedStdin, TerminalInputManager>();

function getInputManager(stdin: ManagedStdin): TerminalInputManager {
	let manager = inputManagers.get(stdin);
	if (!manager) {
		manager = new TerminalInputManager(stdin);
		inputManagers.set(stdin, manager);
	}
	return manager;
}

export function normalizeTextAreaInput(sequence: string): TextAreaInputEvent {
	const keypress = parseTerminalKeypress(sequence) as ParsedTerminalKeypress;
	const key: Key = {
		upArrow: keypress.name === "up",
		downArrow: keypress.name === "down",
		leftArrow: keypress.name === "left",
		rightArrow: keypress.name === "right",
		pageDown: keypress.name === "pagedown",
		pageUp: keypress.name === "pageup",
		home: keypress.name === "home",
		end: keypress.name === "end",
		return: keypress.name === "return",
		escape: keypress.name === "escape",
		ctrl: keypress.ctrl,
		shift: keypress.shift,
		tab: keypress.name === "tab",
		backspace: keypress.name === "backspace",
		delete: keypress.name === "delete",
		meta:
			keypress.meta || keypress.name === "escape" || Boolean(keypress.option),
		super: keypress.super ?? false,
		hyper: keypress.hyper ?? false,
		capsLock: keypress.capsLock ?? false,
		numLock: keypress.numLock ?? false,
		eventType: keypress.eventType,
	};

	let input: string;
	if (keypress.isKittyProtocol) {
		if (keypress.isPrintable) {
			input = keypress.text ?? keypress.name;
		} else if (keypress.ctrl && keypress.name.length === 1) {
			input = keypress.name;
		} else {
			input = "";
		}
	} else if (keypress.ctrl) {
		input = keypress.name;
	} else {
		input = keypress.sequence;
	}

	if (
		!keypress.isKittyProtocol &&
		nonAlphanumericKeys.includes(keypress.name)
	) {
		input = "";
	}
	if (input.startsWith("\u001B")) {
		input = input.slice(1);
	}
	if (input.length === 1 && /[A-Z]/.test(input)) {
		key.shift = true;
	}

	return { input, key, sequence: keypress.sequence || sequence };
}

export function useTerminalInput(
	onInput: (event: TextAreaInputEvent) => void,
	isActive: boolean,
) {
	const { stdin } = useStdin();

	useEffect(() => {
		if (!isActive || !stdin || typeof stdin.read !== "function") {
			return;
		}

		return getInputManager(stdin as ManagedStdin).subscribe(onInput);
	}, [isActive, onInput, stdin]);
}

export function useTextAreaInput(
	onInput: (event: TextAreaInputEvent) => void,
	isActive: boolean,
) {
	useTerminalInput(onInput, isActive);
}
