import { describe, expect, mock, test } from "bun:test";
import type { BrowserApi } from "../../../src/runtime/supervisor/browser-api-router.ts";
import { handleTerminalGatewayRequest } from "../../../src/runtime/supervisor/terminal-gateway.ts";

function terminalUpgradeRequest(url: URL): Request {
	return new Request(url, {
		headers: {
			upgrade: "websocket",
		},
	});
}

describe("handleTerminalGatewayRequest", () => {
	test("passes coding workspace resolution errors to the terminal socket", () => {
		const url = new URL(
			"http://localhost/terminal?repositoryId=repo-1&providerId=codex&sdkSessionId=thread-1",
		);
		let upgradedData:
			| {
					socketType: "runtime" | "terminal";
					terminalCwd?: string;
					terminalError?: string;
			  }
			| undefined;
		const server = {
			upgrade: mock(
				(
					_req: Request,
					options: {
						data: {
							clientType: "browser";
							socketType: "terminal";
							terminalCwd?: string;
							terminalError?: string;
						};
					},
				) => {
					upgradedData = options.data;
					return true;
				},
			),
		};
		const browserApi = {
			getCodingRepositoryCwd: () => {
				throw new Error("Coding repository path does not exist: /missing/repo");
			},
		} as unknown as BrowserApi;

		const response = handleTerminalGatewayRequest(
			terminalUpgradeRequest(url),
			url,
			server,
			browserApi,
		);

		expect(response).toBeUndefined();
		expect(upgradedData).toMatchObject({
			socketType: "terminal",
			terminalError: "Coding repository path does not exist: /missing/repo",
		});
		expect(upgradedData?.terminalCwd).toBeUndefined();
	});
});
