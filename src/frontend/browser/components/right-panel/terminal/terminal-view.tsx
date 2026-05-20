import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import type { BrowserTerminalTarget } from "../../../../../common/protocol.ts";
import { useWs } from "../../../contexts/websocket-context.tsx";
import {
	type BrowserTerminalRuntimeEvent,
	subscribeTerminalRuntimeEvents,
} from "./terminal-events.ts";

interface TerminalViewProps {
	active: boolean;
	name: string;
	onRunRequestDispatched?: (requestId: number) => void;
	runRequest?: TerminalRunRequest | null;
	runtimeState: "pending" | "ready";
	scopeId: string;
	target: BrowserTerminalTarget;
	terminalId: string;
}

export interface TerminalRunRequest {
	command: string;
	id: number;
}

export function toTerminalRunInput(command: string): string {
	return `${command}\r`;
}

export function TerminalView({
	active,
	name,
	onRunRequestDispatched,
	runRequest,
	runtimeState,
	scopeId,
	target,
	terminalId,
}: TerminalViewProps) {
	const { connected, sendTerminalMessage, ws } = useWs();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const attachedRef = useRef(false);
	const activeRef = useRef(active);
	const onRunRequestDispatchedRef = useRef(onRunRequestDispatched);
	const pendingRunRequestRef = useRef<TerminalRunRequest | null>(null);
	const requestedSocketRef = useRef<WebSocket | null>(null);
	const sendTerminalInputRef = useRef<(input: string) => boolean>(() => false);
	const sendResizeRef = useRef<() => void>(() => {});

	useEffect(() => {
		activeRef.current = active;
	}, [active]);

	useEffect(() => {
		onRunRequestDispatchedRef.current = onRunRequestDispatched;
	}, [onRunRequestDispatched]);

	const sendResize = useCallback(() => {
		const terminal = terminalRef.current;
		if (!terminal || !connected || !attachedRef.current) {
			return;
		}

		sendTerminalMessage({
			type: "terminal_resize",
			cols: terminal.cols,
			rows: terminal.rows,
			terminalId,
		});
	}, [connected, sendTerminalMessage, terminalId]);

	const sendTerminalInput = useCallback(
		(input: string): boolean => {
			if (!connected || !attachedRef.current) {
				return false;
			}
			return sendTerminalMessage({
				type: "terminal_input",
				data: input,
				terminalId,
			});
		},
		[connected, sendTerminalMessage, terminalId],
	);

	useEffect(() => {
		sendTerminalInputRef.current = sendTerminalInput;
	}, [sendTerminalInput]);

	useEffect(() => {
		sendResizeRef.current = sendResize;
	}, [sendResize]);

	const dispatchPendingRunRequest = useCallback(() => {
		const pendingRunRequest = pendingRunRequestRef.current;
		if (
			pendingRunRequest &&
			sendTerminalInputRef.current(
				toTerminalRunInput(pendingRunRequest.command),
			)
		) {
			pendingRunRequestRef.current = null;
			onRunRequestDispatchedRef.current?.(pendingRunRequest.id);
		}
	}, []);

	useEffect(() => {
		if (!containerRef.current || terminalId === "") {
			return;
		}

		const container = containerRef.current;
		const rootStyle = getComputedStyle(document.documentElement);
		const terminal = new Terminal({
			cursorBlink: true,
			fontFamily: '"Share Tech Mono", monospace',
			fontSize: 12,
			theme: {
				background:
					rootStyle.getPropertyValue("--dark-950").trim() || "#120e0b",
				foreground:
					rootStyle.getPropertyValue("--dark-100").trim() || "#e0e0e0",
				cursor: "#ffffff",
			},
		});
		terminalRef.current = terminal;
		const fitAddon = new FitAddon();
		fitAddonRef.current = fitAddon;
		terminal.loadAddon(fitAddon);
		terminal.open(container);
		fitAddon.fit();

		const resizeObserver = new ResizeObserver(() => {
			if (!activeRef.current) {
				return;
			}

			fitAddon.fit();
			sendResizeRef.current();
		});
		resizeObserver.observe(container);

		const handlePointerDown = () => {
			terminalRef.current?.focus();
		};
		container.addEventListener("pointerdown", handlePointerDown);

		const disposable = terminal.onData((data) => {
			sendTerminalInputRef.current(data);
		});

		return () => {
			disposable.dispose();
			container.removeEventListener("pointerdown", handlePointerDown);
			terminalRef.current = null;
			fitAddonRef.current = null;
			resizeObserver.disconnect();
			terminal.dispose();
		};
	}, [terminalId]);

	useEffect(() => {
		if (!connected) {
			attachedRef.current = false;
			requestedSocketRef.current = null;
		}
	}, [connected]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!connected || !ws || !terminal || !scopeId || !terminalId || !name) {
			return;
		}
		if (requestedSocketRef.current === ws) {
			return;
		}

		attachedRef.current = false;
		const dimensions = {
			cols: terminal.cols,
			rows: terminal.rows,
		};
		const sent =
			runtimeState === "ready"
				? sendTerminalMessage({
						type: "terminal_attach",
						...dimensions,
						terminalId,
					})
				: sendTerminalMessage({
						type: "terminal_create",
						...dimensions,
						name,
						scopeId,
						target,
						terminalId,
					});
		if (sent) {
			requestedSocketRef.current = ws;
		}
	}, [
		connected,
		name,
		runtimeState,
		scopeId,
		sendTerminalMessage,
		target,
		terminalId,
		ws,
	]);

	useEffect(() => {
		function handleTerminalRuntimeEvent(event: BrowserTerminalRuntimeEvent) {
			const terminal = terminalRef.current;
			if (!terminal) {
				return;
			}

			if (event.type === "terminal_attached") {
				attachedRef.current = true;
				terminal.reset();
				if (event.bufferedOutput.length > 0) {
					terminal.write(event.bufferedOutput);
				}
				sendResizeRef.current();
				dispatchPendingRunRequest();
				return;
			}
			if (event.type === "terminal_output") {
				terminal.write(event.data);
				return;
			}
			if (event.type === "terminal_error") {
				terminal.writeln(`\r\n[terminal error] ${event.message}`);
				return;
			}
			if (event.type === "terminal_closed") {
				attachedRef.current = false;
				terminal.writeln("\r\n[terminal closed]");
			}
		}

		return subscribeTerminalRuntimeEvents(
			terminalId,
			handleTerminalRuntimeEvent,
		);
	}, [dispatchPendingRunRequest, terminalId]);

	useEffect(() => {
		if (!runRequest) {
			return;
		}

		if (sendTerminalInput(toTerminalRunInput(runRequest.command))) {
			pendingRunRequestRef.current = null;
			onRunRequestDispatchedRef.current?.(runRequest.id);
			return;
		}

		pendingRunRequestRef.current = runRequest;
	}, [runRequest, sendTerminalInput]);

	useEffect(() => {
		if (!active) {
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			fitAddonRef.current?.fit();
			terminalRef.current?.focus();
			sendResizeRef.current();
		});

		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [active]);

	return (
		<div
			className={`browser-terminal-shell min-h-0 min-w-0 flex-1 overflow-hidden ${
				active ? "flex" : "hidden"
			}`}
			data-terminal-id={terminalId}
		>
			<div ref={containerRef} className="h-full w-full px-2 py-2" />
		</div>
	);
}
