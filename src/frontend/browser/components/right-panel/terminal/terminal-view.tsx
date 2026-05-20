import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import {
	createTerminalSocketLifecycle,
	type TerminalSocketLifecycle,
} from "./terminal-socket-lifecycle.ts";

interface TerminalViewProps {
	active: boolean;
	agentId?: string;
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
	onRunRequestDispatched?: (requestId: number) => void;
	runRequest?: TerminalRunRequest | null;
	terminalId: string;
}

export interface TerminalRunRequest {
	command: string;
	id: number;
}

export function toTerminalRunInput(command: string): string {
	return `${command}\r`;
}

function buildTerminalUrl(params: {
	agentId?: string;
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
}): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/terminal`);
	if (params.repositoryId) {
		url.searchParams.set("repositoryId", params.repositoryId);
		if (params.providerId) {
			url.searchParams.set("providerId", params.providerId);
		}
		if (params.sdkSessionId) {
			url.searchParams.set("sdkSessionId", params.sdkSessionId);
		}
	} else if (params.agentId) {
		url.searchParams.set("agentId", params.agentId);
	}
	return url.toString();
}

export function TerminalView({
	active,
	agentId,
	providerId,
	repositoryId,
	sdkSessionId,
	onRunRequestDispatched,
	runRequest,
	terminalId,
}: TerminalViewProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const socketLifecycleRef = useRef<TerminalSocketLifecycle<WebSocket> | null>(
		null,
	);
	const activeRef = useRef(active);
	const onRunRequestDispatchedRef = useRef(onRunRequestDispatched);
	const pendingRunRequestRef = useRef<TerminalRunRequest | null>(null);
	const connectionParamsRef = useRef({
		agentId,
		providerId,
		repositoryId,
		sdkSessionId,
	});
	connectionParamsRef.current = {
		agentId,
		providerId,
		repositoryId,
		sdkSessionId,
	};
	const connectionKey = repositoryId
		? `repository:${repositoryId}:${providerId ?? ""}:${sdkSessionId ?? ""}`
		: (agentId ?? "");

	useEffect(() => {
		activeRef.current = active;
	}, [active]);

	useEffect(() => {
		onRunRequestDispatchedRef.current = onRunRequestDispatched;
	}, [onRunRequestDispatched]);

	const sendResize = useCallback(() => {
		const terminal = terminalRef.current;
		const socketLifecycle = socketLifecycleRef.current;
		if (!terminal || !socketLifecycle) {
			return;
		}

		socketLifecycle.send(
			JSON.stringify({
				type: "resize",
				cols: terminal.cols,
				rows: terminal.rows,
			}),
		);
	}, []);

	const sendTerminalInput = useCallback((input: string): boolean => {
		return socketLifecycleRef.current?.send(input) ?? false;
	}, []);

	useEffect(() => {
		if (!containerRef.current || connectionKey === "") {
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
			sendResize();
		});
		resizeObserver.observe(container);

		const handlePointerDown = () => {
			terminalRef.current?.focus();
		};
		container.addEventListener("pointerdown", handlePointerDown);

		let disconnected = false;
		const socketLifecycle = createTerminalSocketLifecycle<WebSocket>({
			isSocketOpen: (socket) => socket.readyState === WebSocket.OPEN,
			onConnected: () => {
				if (disconnected) {
					terminal.writeln("\r\n[terminal reconnected]");
				}
				disconnected = false;
				sendResize();
				const pendingRunRequest = pendingRunRequestRef.current;
				if (
					pendingRunRequest &&
					sendTerminalInput(toTerminalRunInput(pendingRunRequest.command))
				) {
					pendingRunRequestRef.current = null;
					onRunRequestDispatchedRef.current?.(pendingRunRequest.id);
				}
			},
			onData: (data) => {
				terminal.write(data);
			},
			onDisconnected: () => {
				if (disconnected) {
					return;
				}
				disconnected = true;
				terminal.writeln("\r\n[terminal disconnected; reconnecting]");
			},
			onError: () => {
				if (!disconnected) {
					terminal.writeln("\r\n[terminal error]");
				}
			},
			openSocket: () =>
				new WebSocket(buildTerminalUrl(connectionParamsRef.current)),
			setCurrentSocket: () => {},
		});
		socketLifecycleRef.current = socketLifecycle;
		socketLifecycle.start();

		const disposable = terminal.onData((data) => {
			sendTerminalInput(data);
		});

		return () => {
			disposable.dispose();
			socketLifecycle.stop();
			container.removeEventListener("pointerdown", handlePointerDown);
			if (socketLifecycleRef.current === socketLifecycle) {
				socketLifecycleRef.current = null;
			}
			terminalRef.current = null;
			fitAddonRef.current = null;
			resizeObserver.disconnect();
			terminal.dispose();
		};
	}, [connectionKey, sendResize, sendTerminalInput]);

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
			sendResize();
		});

		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [active, sendResize]);

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
