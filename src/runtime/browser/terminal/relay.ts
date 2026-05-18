import type { ServerWebSocket } from "bun";

interface TerminalSocketData {
	socketType: "runtime" | "terminal";
	terminalCwd?: string;
	terminalError?: string;
}

type TerminalSocket = ServerWebSocket<TerminalSocketData>;

interface TerminalSession {
	closed: boolean;
	cancelStartupInputFallback: (() => void) | null;
	cols: number;
	decoder: TextDecoder;
	proc: Bun.Subprocess | null;
	queuedInput: string[];
	readyForInput: boolean;
	rows: number;
	terminal: Bun.Terminal;
}

interface TerminalRuntime {
	createTerminal: (
		options: ConstructorParameters<typeof Bun.Terminal>[0],
	) => Bun.Terminal;
	spawn: typeof Bun.spawn;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const STARTUP_INPUT_FALLBACK_MS = 300;

const defaultTerminalRuntime: TerminalRuntime = {
	createTerminal: (options) => new Bun.Terminal(options),
	spawn: Bun.spawn,
};

interface TerminalRelayOptions {
	scheduleStartupInputFallback?: (
		callback: () => void,
		delayMs: number,
	) => () => void;
	startupInputFallbackMs?: number;
}

function scheduleStartupInputFallback(
	callback: () => void,
	delayMs: number,
): () => void {
	const timer = setTimeout(callback, delayMs);
	return () => {
		clearTimeout(timer);
	};
}

function getTerminalEnv(): Record<string, string> {
	return {
		...Object.fromEntries(
			Object.entries(process.env).filter(
				(entry): entry is [string, string] => typeof entry[1] === "string",
			),
		),
		COLORTERM: "truecolor",
		TERM: "xterm-256color",
	};
}

export class TerminalRelay {
	private readonly sessions = new Map<TerminalSocket, TerminalSession>();

	constructor(
		private readonly runtime: TerminalRuntime = defaultTerminalRuntime,
		private readonly options: TerminalRelayOptions = {},
	) {}

	handleClose = (ws: TerminalSocket) => {
		this.stopSession(ws);
	};

	handleMessage = (ws: TerminalSocket, message: string | Buffer) => {
		const session = this.sessions.get(ws);
		if (!session) {
			return;
		}

		if (typeof message === "string") {
			try {
				const parsed = JSON.parse(message) as {
					cols?: number;
					rows?: number;
					type?: string;
				};
				if (parsed.type === "resize") {
					this.resizeSession(ws, parsed.cols, parsed.rows);
					return;
				}
			} catch {
				// Treat non-JSON payloads as terminal input.
			}

			this.writeInput(session, message);
			return;
		}

		this.writeInput(session, new TextDecoder().decode(message));
	};

	handleOpen = (ws: TerminalSocket) => {
		if (ws.data.terminalError) {
			this.reportUnavailableTarget(ws, ws.data.terminalError);
			return;
		}
		const cwd = ws.data.terminalCwd;
		if (!cwd) {
			this.reportUnavailableTarget(ws, "Terminal workspace is not available");
			return;
		}

		const shell = process.env.SHELL || "/bin/bash";
		const decoder = new TextDecoder();
		let session: TerminalSession | undefined;
		const terminal = this.runtime.createTerminal({
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
			data: (_terminal, data) => {
				if (ws.readyState !== WebSocket.OPEN) {
					return;
				}

				const text = decoder.decode(data, { stream: true });
				if (text.length > 0) {
					ws.send(text);
					if (session) {
						this.markReadyForInput(session);
					}
				}
			},
		});
		session = {
			closed: false,
			cancelStartupInputFallback: null,
			cols: DEFAULT_COLS,
			decoder,
			proc: null,
			queuedInput: [],
			readyForInput: false,
			rows: DEFAULT_ROWS,
			terminal,
		};
		this.sessions.set(ws, session);
		let subprocess: Bun.Subprocess;
		try {
			subprocess = this.runtime.spawn([shell], {
				cwd,
				env: getTerminalEnv(),
				terminal,
			});
		} catch (error) {
			this.failStartup(ws, error);
			return;
		}
		session.proc = subprocess;
		session.cancelStartupInputFallback = (
			this.options.scheduleStartupInputFallback ?? scheduleStartupInputFallback
		)(() => this.markReadyForInput(session), this.startupInputFallbackMs);

		void subprocess.exited.finally(() => {
			this.finalizeSession(ws);
			if (ws.readyState === WebSocket.OPEN) {
				ws.close();
			}
		});
	};

	private reportUnavailableTarget(ws: TerminalSocket, message: string) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(`${message}\r\n`);
			ws.close();
		}
	}

	private failStartup(ws: TerminalSocket, error: unknown) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(`Terminal failed to start: ${formatError(error)}\r\n`);
		}
		this.finalizeSession(ws);
		if (ws.readyState === WebSocket.OPEN) {
			ws.close();
		}
	}

	private resizeSession(
		ws: TerminalSocket,
		cols: number | undefined,
		rows: number | undefined,
	) {
		if (
			!Number.isInteger(cols) ||
			!Number.isInteger(rows) ||
			cols === undefined ||
			rows === undefined
		) {
			return;
		}

		const session = this.sessions.get(ws);
		if (!session) {
			return;
		}

		session.terminal.resize(cols, rows);
		session.cols = cols;
		session.rows = rows;
		if (!session.proc) {
			return;
		}
		try {
			session.proc.kill("SIGWINCH");
		} catch {
			// Ignore if the process already exited.
		}
	}

	private finalizeSession(ws: TerminalSocket) {
		const session = this.sessions.get(ws);
		if (!session || session.closed) {
			return;
		}
		session.closed = true;

		const tail = session.decoder.decode();
		if (tail.length > 0 && ws.readyState === WebSocket.OPEN) {
			ws.send(tail);
		}
		session.cancelStartupInputFallback?.();
		session.cancelStartupInputFallback = null;

		try {
			session.terminal.close();
		} catch {
			// Ignore if the terminal is already closed.
		}

		this.sessions.delete(ws);
	}

	private stopSession(ws: TerminalSocket) {
		const session = this.sessions.get(ws);
		if (!session) {
			return;
		}

		if (session.proc) {
			try {
				session.proc.kill();
			} catch {
				// Ignore already-exited processes.
			}
		}
		this.finalizeSession(ws);
	}

	private writeInput(session: TerminalSession, input: string) {
		if (!session.readyForInput) {
			session.queuedInput.push(input);
			return;
		}

		session.terminal.write(input);
	}

	private markReadyForInput(session: TerminalSession) {
		if (session.readyForInput) {
			return;
		}

		session.readyForInput = true;
		session.cancelStartupInputFallback?.();
		session.cancelStartupInputFallback = null;
		const queuedInput = session.queuedInput;
		session.queuedInput = [];
		for (const input of queuedInput) {
			session.terminal.write(input);
		}
	}

	private get startupInputFallbackMs() {
		return this.options.startupInputFallbackMs ?? STARTUP_INPUT_FALLBACK_MS;
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
