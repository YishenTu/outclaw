import type {
	BrowserTerminalSummary,
	BrowserTerminalTarget,
	ServerEvent,
} from "../../../common/protocol.ts";
import { serialize } from "../../../common/protocol.ts";

interface TerminalClient {
	data: {
		clientType: string;
		cookieClientId?: string;
	};
	send: (message: string) => void;
}

interface TerminalRuntime {
	createTerminal: (
		options: ConstructorParameters<typeof Bun.Terminal>[0],
	) => Bun.Terminal;
	spawn: typeof Bun.spawn;
}

interface TerminalSession {
	attachedClient: TerminalClient | null;
	cancelIdleClose: (() => void) | null;
	cancelStartupInputFallback: (() => void) | null;
	closed: boolean;
	cols: number;
	cwd: string;
	decoder: TextDecoder;
	outputBuffer: string;
	proc: Bun.Subprocess | null;
	queuedInput: string[];
	readyForInput: boolean;
	rows: number;
	summary: BrowserTerminalSummary;
	terminal: Bun.Terminal;
}

interface BrowserTerminalManagerOptions {
	idleCloseMs?: number;
	outputBufferLimitBytes?: number;
	scheduleIdleClose?: (callback: () => void, delayMs: number) => () => void;
	scheduleStartupInputFallback?: (
		callback: () => void,
		delayMs: number,
	) => () => void;
	startupInputFallbackMs?: number;
}

interface CreateTerminalParams {
	client: TerminalClient;
	cols?: number;
	cwd: string;
	name: string;
	rows?: number;
	scopeId: string;
	target: BrowserTerminalTarget;
	terminalId: string;
}

interface AttachTerminalParams {
	client: TerminalClient;
	cols?: number;
	rows?: number;
	terminalId: string;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_IDLE_CLOSE_MS = 30 * 60 * 1000;
const DEFAULT_OUTPUT_BUFFER_LIMIT_BYTES = 256 * 1024;
const STARTUP_INPUT_FALLBACK_MS = 300;

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

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
	const timer = setTimeout(callback, delayMs);
	return () => {
		clearTimeout(timer);
	};
}

export class BrowserTerminalManager {
	private readonly sessionsByOwner = new Map<
		string,
		Map<string, TerminalSession>
	>();

	constructor(
		private readonly runtime: TerminalRuntime = defaultTerminalRuntime,
		private readonly options: BrowserTerminalManagerOptions = {},
	) {}

	list(ownerId: string): BrowserTerminalSummary[] {
		return [...(this.sessionsByOwner.get(ownerId)?.values() ?? [])].map(
			(session) => session.summary,
		);
	}

	create(params: CreateTerminalParams): BrowserTerminalSummary | undefined {
		const ownerId = this.resolveOwnerId(params.client);
		if (!ownerId) {
			this.send(params.client, {
				type: "terminal_error",
				message: "Browser terminal owner is not available",
				terminalId: params.terminalId,
			});
			return undefined;
		}

		const existing = this.getSession(ownerId, params.terminalId);
		if (existing) {
			this.attach(params);
			return existing.summary;
		}

		const cols = resolveDimension(params.cols, DEFAULT_COLS);
		const rows = resolveDimension(params.rows, DEFAULT_ROWS);
		const decoder = new TextDecoder();
		let session: TerminalSession | undefined;
		const terminal = this.runtime.createTerminal({
			cols,
			rows,
			data: (_terminal, data) => {
				if (!session || session.closed) {
					return;
				}
				const text = decoder.decode(data, { stream: true });
				if (text.length === 0) {
					return;
				}
				this.recordOutput(session, text);
				this.sendOutput(session, text);
				this.markReadyForInput(session);
			},
		});
		session = {
			attachedClient: params.client,
			cancelIdleClose: null,
			cancelStartupInputFallback: null,
			closed: false,
			cols,
			cwd: params.cwd,
			decoder,
			outputBuffer: "",
			proc: null,
			queuedInput: [],
			readyForInput: false,
			rows,
			summary: {
				createdAt: Date.now(),
				id: params.terminalId,
				name: params.name,
				scopeId: params.scopeId,
				target: params.target,
			},
			terminal,
		};
		this.setSession(ownerId, session);
		try {
			session.proc = this.runtime.spawn([process.env.SHELL || "/bin/bash"], {
				cwd: params.cwd,
				env: getTerminalEnv(),
				terminal,
			});
		} catch (error) {
			this.send(params.client, {
				type: "terminal_error",
				message: `Terminal failed to start: ${formatError(error)}`,
				terminalId: params.terminalId,
			});
			this.finalizeSession(ownerId, session, { notify: false });
			return undefined;
		}

		session.cancelStartupInputFallback = (
			this.options.scheduleStartupInputFallback ?? scheduleTimeout
		)(() => this.markReadyForInput(session), this.startupInputFallbackMs);

		void session.proc.exited.finally(() => {
			this.finalizeSession(ownerId, session, { notify: true });
		});

		this.resize(ownerId, params.terminalId, cols, rows);
		this.send(params.client, {
			type: "terminal_created",
			terminal: session.summary,
		});
		this.send(params.client, {
			type: "terminal_attached",
			bufferedOutput: session.outputBuffer,
			terminalId: session.summary.id,
		});
		return session.summary;
	}

	attach(params: AttachTerminalParams): boolean {
		const ownerId = this.resolveOwnerId(params.client);
		if (!ownerId) {
			this.send(params.client, {
				type: "terminal_error",
				message: "Browser terminal owner is not available",
				terminalId: params.terminalId,
			});
			return false;
		}

		const session = this.getSession(ownerId, params.terminalId);
		if (!session) {
			this.send(params.client, {
				type: "terminal_error",
				message: "Terminal session is not available",
				terminalId: params.terminalId,
			});
			return false;
		}

		session.cancelIdleClose?.();
		session.cancelIdleClose = null;
		session.attachedClient = params.client;
		if (params.cols !== undefined && params.rows !== undefined) {
			this.resize(ownerId, params.terminalId, params.cols, params.rows);
		}
		this.send(params.client, {
			type: "terminal_attached",
			bufferedOutput: session.outputBuffer,
			terminalId: params.terminalId,
		});
		return true;
	}

	input(ownerId: string, terminalId: string, input: string): boolean {
		const session = this.getSession(ownerId, terminalId);
		if (!session || session.closed) {
			return false;
		}
		this.writeInput(session, input);
		return true;
	}

	resize(
		ownerId: string,
		terminalId: string,
		cols: number,
		rows: number,
	): boolean {
		if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
			return false;
		}
		const session = this.getSession(ownerId, terminalId);
		if (!session || session.closed) {
			return false;
		}

		session.cols = cols;
		session.rows = rows;
		session.terminal.resize(cols, rows);
		if (!session.proc) {
			return true;
		}
		try {
			session.proc.kill("SIGWINCH");
		} catch {
			// Ignore if the process already exited.
		}
		return true;
	}

	close(ownerId: string, terminalId: string): boolean {
		const session = this.getSession(ownerId, terminalId);
		if (!session) {
			return false;
		}
		this.stopSession(ownerId, session);
		return true;
	}

	detachClient(client: TerminalClient) {
		for (const [ownerId, sessions] of this.sessionsByOwner) {
			for (const session of sessions.values()) {
				if (session.attachedClient !== client) {
					continue;
				}
				session.attachedClient = null;
				session.cancelIdleClose?.();
				session.cancelIdleClose = (
					this.options.scheduleIdleClose ?? scheduleTimeout
				)(() => this.stopSession(ownerId, session), this.idleCloseMs);
			}
		}
	}

	stopAll() {
		for (const [ownerId, sessions] of [...this.sessionsByOwner]) {
			for (const session of [...sessions.values()]) {
				this.stopSession(ownerId, session);
			}
		}
	}

	private get idleCloseMs(): number {
		return this.options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS;
	}

	private get outputBufferLimitBytes(): number {
		return (
			this.options.outputBufferLimitBytes ?? DEFAULT_OUTPUT_BUFFER_LIMIT_BYTES
		);
	}

	private get startupInputFallbackMs(): number {
		return this.options.startupInputFallbackMs ?? STARTUP_INPUT_FALLBACK_MS;
	}

	private resolveOwnerId(client: TerminalClient): string | undefined {
		return client.data.clientType === "browser"
			? client.data.cookieClientId
			: undefined;
	}

	private setSession(ownerId: string, session: TerminalSession) {
		let ownerSessions = this.sessionsByOwner.get(ownerId);
		if (!ownerSessions) {
			ownerSessions = new Map();
			this.sessionsByOwner.set(ownerId, ownerSessions);
		}
		ownerSessions.set(session.summary.id, session);
	}

	private getSession(
		ownerId: string,
		terminalId: string,
	): TerminalSession | undefined {
		return this.sessionsByOwner.get(ownerId)?.get(terminalId);
	}

	private deleteSession(ownerId: string, terminalId: string) {
		const sessions = this.sessionsByOwner.get(ownerId);
		if (!sessions) {
			return;
		}
		sessions.delete(terminalId);
		if (sessions.size === 0) {
			this.sessionsByOwner.delete(ownerId);
		}
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

	private recordOutput(session: TerminalSession, text: string) {
		session.outputBuffer = `${session.outputBuffer}${text}`;
		if (session.outputBuffer.length <= this.outputBufferLimitBytes) {
			return;
		}
		session.outputBuffer = session.outputBuffer.slice(
			-this.outputBufferLimitBytes,
		);
	}

	private sendOutput(session: TerminalSession, data: string) {
		if (!session.attachedClient) {
			return;
		}
		const sent = this.send(session.attachedClient, {
			type: "terminal_output",
			data,
			terminalId: session.summary.id,
		});
		if (!sent) {
			session.attachedClient = null;
		}
	}

	private stopSession(ownerId: string, session: TerminalSession) {
		if (session.proc) {
			try {
				session.proc.kill();
			} catch {
				// Ignore already-exited processes.
			}
		}
		this.finalizeSession(ownerId, session, { notify: true });
	}

	private finalizeSession(
		ownerId: string,
		session: TerminalSession,
		options: { notify: boolean },
	) {
		if (session.closed) {
			return;
		}
		session.closed = true;
		const tail = session.decoder.decode();
		if (tail.length > 0) {
			this.recordOutput(session, tail);
			this.sendOutput(session, tail);
		}
		session.cancelIdleClose?.();
		session.cancelIdleClose = null;
		session.cancelStartupInputFallback?.();
		session.cancelStartupInputFallback = null;
		try {
			session.terminal.close();
		} catch {
			// Ignore if the terminal is already closed.
		}
		this.deleteSession(ownerId, session.summary.id);
		if (options.notify && session.attachedClient) {
			this.send(session.attachedClient, {
				type: "terminal_closed",
				terminalId: session.summary.id,
			});
		}
	}

	private send(client: TerminalClient, event: ServerEvent): boolean {
		const readyState = (client as TerminalClient & { readyState?: number })
			.readyState;
		if (readyState !== undefined && readyState !== WebSocket.OPEN) {
			return false;
		}
		try {
			client.send(serialize(event));
			return true;
		} catch {
			return false;
		}
	}
}

function resolveDimension(value: number | undefined, fallback: number): number {
	return Number.isInteger(value) && value !== undefined ? value : fallback;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
