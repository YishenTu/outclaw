import type { ServerWebSocket } from "bun";

interface TerminalSocketData {
	socketType: "runtime" | "terminal";
	terminalCwd?: string;
}

type TerminalSocket = ServerWebSocket<TerminalSocketData>;

interface TerminalSession {
	closed: boolean;
	cols: number;
	decoder: TextDecoder;
	proc: Bun.Subprocess;
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

const defaultTerminalRuntime: TerminalRuntime = {
	createTerminal: (options) => new Bun.Terminal(options),
	spawn: Bun.spawn,
};

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

			session.terminal.write(message);
			return;
		}

		session.terminal.write(new TextDecoder().decode(message));
	};

	handleOpen = (ws: TerminalSocket) => {
		const cwd = ws.data.terminalCwd;
		if (!cwd) {
			ws.send("Unknown agent\r\n");
			ws.close();
			return;
		}

		const shell = process.env.SHELL || "/bin/bash";
		const decoder = new TextDecoder();
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
				}
			},
		});
		const subprocess = this.runtime.spawn([shell], {
			cwd,
			env: getTerminalEnv(),
			terminal,
		});
		this.sessions.set(ws, {
			closed: false,
			cols: DEFAULT_COLS,
			decoder,
			proc: subprocess,
			rows: DEFAULT_ROWS,
			terminal,
		});

		ws.send(`Connected to ${cwd}\r\n`);
		void subprocess.exited.finally(() => {
			this.finalizeSession(ws);
			if (ws.readyState === WebSocket.OPEN) {
				ws.close();
			}
		});
	};

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

		try {
			session.proc.kill();
		} catch {
			// Ignore already-exited processes.
		}
		this.finalizeSession(ws);
	}
}
