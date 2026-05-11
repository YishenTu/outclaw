import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { CodexRpcTransport } from "../../../src/backend/adapters/codex/rpc-transport.ts";

class FakeCodexProcess {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	private readonly exitHandlers = new Set<
		(code: number | null, signal: NodeJS.Signals | null) => void
	>();

	onExit(
		handler: (code: number | null, signal: NodeJS.Signals | null) => void,
	): void {
		this.exitHandlers.add(handler);
	}

	emitServerMessage(message: unknown): void {
		this.stdout.write(`${JSON.stringify(message)}\n`);
	}

	readClientMessage(): Promise<Record<string, unknown>> {
		return new Promise((resolve) => {
			const listener = (chunk: Buffer) => {
				this.stdin.off("data", listener);
				resolve(JSON.parse(String(chunk)) as Record<string, unknown>);
			};
			this.stdin.on("data", listener);
		});
	}

	exit(): void {
		for (const handler of this.exitHandlers) {
			handler(0, null);
		}
	}
}

describe("CodexRpcTransport", () => {
	test("answers handled JSON-RPC server requests", async () => {
		const process = new FakeCodexProcess();
		const transport = new CodexRpcTransport(process, {
			handleServerRequest: (request) => {
				expect(request).toEqual({
					id: 7,
					method: "approval/request",
					params: { command: "bun test" },
				});
				return { approved: true };
			},
		});
		transport.start();

		const response = process.readClientMessage();
		process.emitServerMessage({
			jsonrpc: "2.0",
			id: 7,
			method: "approval/request",
			params: { command: "bun test" },
		});

		expect(await response).toEqual({
			jsonrpc: "2.0",
			id: 7,
			result: { approved: true },
		});

		transport.dispose();
	});

	test("rejects unhandled JSON-RPC server requests", async () => {
		const process = new FakeCodexProcess();
		const transport = new CodexRpcTransport(process);
		transport.start();

		const response = process.readClientMessage();
		process.emitServerMessage({
			jsonrpc: "2.0",
			id: "ask-1",
			method: "approval/request",
		});

		expect(await response).toEqual({
			jsonrpc: "2.0",
			id: "ask-1",
			error: {
				code: -32601,
				message: "Unhandled Codex app-server request: approval/request",
			},
		});

		transport.dispose();
	});
});
