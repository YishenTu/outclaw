import { type ChildProcess, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

const SIGKILL_TIMEOUT_MS = 3_000;

export interface CodexAppServerProcessOptions {
	command: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string | undefined>;
}

type ExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void;

export class CodexAppServerProcess {
	private process: ChildProcess | undefined;
	private alive = false;
	private readonly exitHandlers = new Set<ExitHandler>();

	constructor(private readonly options: CodexAppServerProcessOptions) {}

	start(): void {
		if (this.process) {
			return;
		}

		this.process = spawn(this.options.command, this.options.args, {
			cwd: this.options.cwd,
			env: { ...process.env, ...this.options.env },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.alive = true;

		this.process.on("exit", (code, signal) => {
			this.alive = false;
			for (const handler of this.exitHandlers) {
				handler(code, signal);
			}
		});

		this.process.on("error", () => {
			this.alive = false;
		});
	}

	get stdin(): Writable {
		if (!this.process?.stdin) {
			throw new Error("Codex app-server process is not started");
		}
		return this.process.stdin;
	}

	get stdout(): Readable {
		if (!this.process?.stdout) {
			throw new Error("Codex app-server process is not started");
		}
		return this.process.stdout;
	}

	isAlive(): boolean {
		return this.alive;
	}

	onExit(handler: ExitHandler): void {
		this.exitHandlers.add(handler);
	}

	async shutdown(): Promise<void> {
		if (!this.process || !this.alive) {
			return;
		}

		await new Promise<void>((resolve) => {
			const killTimer = setTimeout(() => {
				if (this.alive) {
					this.process?.kill("SIGKILL");
				}
			}, SIGKILL_TIMEOUT_MS);

			this.process?.once("exit", () => {
				clearTimeout(killTimer);
				resolve();
			});
			this.process?.kill("SIGTERM");
		});
	}
}
