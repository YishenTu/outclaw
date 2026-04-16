import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";

interface TerminalViewProps {
	active: boolean;
	agentId: string;
	terminalId: string;
}

function buildTerminalUrl(agentId: string): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/terminal`);
	url.searchParams.set("agentId", agentId);
	return url.toString();
}

export function TerminalView({
	active,
	agentId,
	terminalId,
}: TerminalViewProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const activeRef = useRef(active);

	useEffect(() => {
		activeRef.current = active;
	}, [active]);

	const sendResize = useCallback(() => {
		const terminal = terminalRef.current;
		const socket = socketRef.current;
		if (!terminal || !socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		socket.send(
			JSON.stringify({
				type: "resize",
				cols: terminal.cols,
				rows: terminal.rows,
			}),
		);
	}, []);

	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const container = containerRef.current;
		const terminal = new Terminal({
			cursorBlink: true,
			fontFamily: '"Share Tech Mono", monospace',
			fontSize: 12,
			theme: {
				background: "#0c0a09",
				foreground: "#f5f4f0",
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

		const socket = new WebSocket(buildTerminalUrl(agentId));
		socketRef.current = socket;
		socket.onopen = () => {
			sendResize();
		};
		socket.onmessage = (event) => {
			terminal.write(String(event.data));
		};
		socket.onclose = () => {
			terminal.writeln("\r\n[terminal disconnected]");
		};
		socket.onerror = () => {
			terminal.writeln("\r\n[terminal error]");
		};

		const disposable = terminal.onData((data) => {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(data);
			}
		});

		return () => {
			disposable.dispose();
			socket.close();
			container.removeEventListener("pointerdown", handlePointerDown);
			socketRef.current = null;
			terminalRef.current = null;
			fitAddonRef.current = null;
			resizeObserver.disconnect();
			terminal.dispose();
		};
	}, [agentId, sendResize]);

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
			className={`min-h-0 min-w-0 flex-1 overflow-hidden ${
				active ? "flex" : "hidden"
			}`}
			data-terminal-id={terminalId}
		>
			<div ref={containerRef} className="h-full w-full px-2 py-2" />
		</div>
	);
}
