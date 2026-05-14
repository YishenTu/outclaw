import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { CodexServerNotification } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
	method: string;
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

interface JsonRpcResponse {
	id?: number | string;
	result?: unknown;
	error?: {
		code?: number;
		message?: string;
		data?: unknown;
	};
}

export interface CodexServerRequest {
	id: number | string;
	method: string;
	params?: unknown;
}

interface CodexRpcTransportOptions {
	handleServerRequest?: (
		request: CodexServerRequest,
	) => unknown | Promise<unknown>;
}

export interface CodexRpcProcess {
	stdin: Writable;
	stdout: Readable;
	onExit(
		handler: (code: number | null, signal: NodeJS.Signals | null) => void,
	): void;
}

export class CodexRpcTransport {
	private nextId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly notificationHandlers = new Set<
		(notification: CodexServerNotification) => void
	>();
	private reader: Interface | undefined;
	private disposed = false;

	constructor(
		private readonly process: CodexRpcProcess,
		private readonly options: CodexRpcTransportOptions = {},
	) {}

	start(): void {
		if (this.reader) {
			return;
		}

		this.reader = createInterface({ input: this.process.stdout });
		this.reader.on("line", (line) => {
			this.handleLine(line);
		});
		this.process.onExit(() => {
			this.rejectAllPending(new Error("Codex app-server process exited"));
		});
	}

	request<T>(method: string, params?: unknown): Promise<T> {
		const id = this.nextId++;
		const message =
			params === undefined ? { id, method } : { id, method, params };

		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex app-server request timed out: ${method}`));
			}, DEFAULT_TIMEOUT_MS);

			this.pending.set(id, {
				method,
				resolve: resolve as (result: unknown) => void,
				reject,
				timer,
			});
			this.sendRaw(message);
		});
	}

	notify(method: string, params?: unknown): void {
		this.sendRaw(params === undefined ? { method } : { method, params });
	}

	subscribe(
		handler: (notification: CodexServerNotification) => void,
	): () => void {
		this.notificationHandlers.add(handler);
		return () => {
			this.notificationHandlers.delete(handler);
		};
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.reader?.close();
		this.rejectAllPending(new Error("Codex app-server transport disposed"));
	}

	private sendRaw(message: unknown): void {
		if (this.disposed) {
			return;
		}
		this.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private handleLine(line: string): void {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}

		const method =
			typeof message.method === "string" ? message.method : undefined;
		const id = message.id;

		if (method && id === undefined) {
			this.emitNotification({ method, params: message.params });
			return;
		}

		if (method && (typeof id === "number" || typeof id === "string")) {
			void this.handleServerRequest({
				id,
				method,
				params: message.params,
			});
			return;
		}

		this.handleResponse(message);
	}

	private handleResponse(message: JsonRpcResponse): void {
		if (typeof message.id !== "number") {
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}

		this.pending.delete(message.id);
		if (pending.timer) {
			clearTimeout(pending.timer);
		}

		if (message.error) {
			pending.reject(
				new Error(
					message.error.message ??
						`Codex app-server request failed: ${pending.method}`,
				),
			);
			return;
		}

		pending.resolve(message.result);
	}

	private emitNotification(notification: CodexServerNotification): void {
		for (const handler of this.notificationHandlers) {
			handler(notification);
		}
	}

	private async handleServerRequest(
		request: CodexServerRequest,
	): Promise<void> {
		if (!this.options.handleServerRequest) {
			this.rejectServerRequest(request);
			return;
		}

		try {
			const result = await this.options.handleServerRequest(request);
			this.sendRaw({
				id: request.id,
				result,
			});
		} catch (error) {
			this.sendRaw({
				id: request.id,
				error: {
					code: -32603,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	private rejectServerRequest(request: CodexServerRequest): void {
		this.sendRaw({
			id: request.id,
			error: {
				code: -32601,
				message: `Unhandled Codex app-server request: ${request.method}`,
			},
		});
	}

	private rejectAllPending(error: Error): void {
		for (const pending of this.pending.values()) {
			if (pending.timer) {
				clearTimeout(pending.timer);
			}
			pending.reject(error);
		}
		this.pending.clear();
	}
}
