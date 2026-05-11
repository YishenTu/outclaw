import { CodexAppServerProcess } from "./app-server-process.ts";
import { CodexRpcTransport } from "./rpc-transport.ts";
import type { CodexAppServerClient, CodexServerNotification } from "./types.ts";

const DEFAULT_CODEX_APP_SERVER_COMMAND = "codex";
const DEFAULT_CODEX_APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"];

export interface CodexAppServerClientOptions {
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string | undefined>;
}

export function createCodexAppServerClient(
	options: CodexAppServerClientOptions = {},
): CodexAppServerClient {
	const process = new CodexAppServerProcess({
		command: options.command ?? DEFAULT_CODEX_APP_SERVER_COMMAND,
		args: options.args ?? DEFAULT_CODEX_APP_SERVER_ARGS,
		cwd: options.cwd,
		env: options.env,
	});
	process.start();

	const transport = new CodexRpcTransport(process);
	transport.start();

	return new CodexRpcAppServerClient(transport, process);
}

class CodexRpcAppServerClient implements CodexAppServerClient {
	private initializePromise: Promise<void> | undefined;

	constructor(
		private readonly transport: CodexRpcTransport,
		private readonly process: CodexAppServerProcess,
	) {}

	initialize(): Promise<void> {
		this.initializePromise ??= this.initializeOnce();
		return this.initializePromise;
	}

	request<T>(method: string, params?: unknown): Promise<T> {
		return this.transport.request<T>(method, params);
	}

	notify(method: string, params?: unknown): void {
		this.transport.notify(method, params);
	}

	subscribe(
		handler: (notification: CodexServerNotification) => void,
	): () => void {
		return this.transport.subscribe(handler);
	}

	async dispose(): Promise<void> {
		this.transport.dispose();
		await this.process.shutdown();
	}

	private async initializeOnce(): Promise<void> {
		await this.transport.request("initialize", {
			clientInfo: {
				name: "outclaw",
				title: "Outclaw",
				version: "0.0.0",
			},
			capabilities: {
				experimentalApi: true,
			},
		});
		this.transport.notify("initialized");
	}
}
