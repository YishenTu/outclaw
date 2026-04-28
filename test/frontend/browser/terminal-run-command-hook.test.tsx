import { afterEach, describe, expect, mock, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import { useLayoutEffect } from "react";
import {
	resolveHeaderTerminalRunAction,
	resolveSavedTerminalRunCommand,
	useAgentTerminalRunCommand,
} from "../../../src/frontend/browser/components/right-panel/use-agent-terminal-run-command.ts";
import {
	CONFIG_SAVE_RESTART_COMMAND,
	CONFIG_SAVE_RESTART_ERROR,
	requestConfigRestart,
} from "../../../src/frontend/browser/config-save-restart.ts";

type Snapshot = ReturnType<typeof useAgentTerminalRunCommand>;

function Observer({
	agentId,
	onSaveSucceeded,
	onSnapshot,
	runtimeCommand,
}: {
	agentId: string;
	onSaveSucceeded?: () => string | null;
	onSnapshot: (snapshot: Snapshot) => void;
	runtimeCommand: string;
}) {
	const command = useAgentTerminalRunCommand(
		agentId,
		runtimeCommand,
		onSaveSucceeded,
	);

	useLayoutEffect(() => {
		onSnapshot(command);
	}, [command, onSnapshot]);

	return <Text>{command.draftCommand}</Text>;
}

function createOutputStream() {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = 80;
	stream.isTTY = false;
	stream.rows = 24;
	return stream;
}

async function flushUpdates() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

async function waitFor(predicate: () => boolean, label: string) {
	for (let index = 0; index < 100; index += 1) {
		if (predicate()) {
			return;
		}
		await flushUpdates();
	}
	throw new Error(`Timed out waiting for ${label}`);
}

describe("useAgentTerminalRunCommand", () => {
	const realFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("uses the runtime summary command without fetching separate browser state", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("unexpected fetch");
		}) as unknown as typeof fetch;

		let latest: Snapshot | undefined;
		const app = render(
			<Observer
				agentId="agent-a"
				runtimeCommand="bun test"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr: createOutputStream(),
				stdin: new PassThrough() as unknown as NodeJS.ReadStream,
				stdout: createOutputStream(),
			},
		);

		try {
			await waitFor(
				() =>
					latest?.command === "bun test" && latest.draftCommand === "bun test",
				"runtime command",
			);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("clears setup state when the restarted runtime reports an empty command", async () => {
		let latest: Snapshot | undefined;
		const app = render(
			<Observer
				agentId="agent-a"
				runtimeCommand="bun test"
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr: createOutputStream(),
				stdin: new PassThrough() as unknown as NodeJS.ReadStream,
				stdout: createOutputStream(),
			},
		);

		try {
			await waitFor(
				() => latest?.command === "bun test",
				"initial runtime command",
			);

			app.rerender(
				<Observer
					agentId="agent-a"
					runtimeCommand=""
					onSnapshot={(snapshot) => {
						latest = snapshot;
					}}
				/>,
			);

			await waitFor(
				() => latest?.command === "" && latest.draftCommand === "",
				"empty runtime command",
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("saves a setup draft without promoting it to configured runtime state", async () => {
		const requests: Array<{ body: unknown; method: string; url: string }> = [];
		const restartCommands: string[] = [];
		globalThis.fetch = mock(async (input, init) => {
			requests.push({
				body: init?.body,
				method: init?.method ?? "GET",
				url: String(input),
			});

			return new Response(JSON.stringify({ command: "" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			});
		}) as unknown as typeof fetch;

		let latest: Snapshot | undefined;
		const app = render(
			<Observer
				agentId="agent-a"
				runtimeCommand=""
				onSaveSucceeded={() =>
					requestConfigRestart((command) => {
						restartCommands.push(command);
						return true;
					})
				}
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr: createOutputStream(),
				stdin: new PassThrough() as unknown as NodeJS.ReadStream,
				stdout: createOutputStream(),
			},
		);

		try {
			await waitFor(() => latest?.command === "", "initial empty command");
			latest?.setDraftCommand("bun test");
			await waitFor(
				() => latest?.draftCommand === "bun test",
				"draft command update",
			);

			await latest?.saveDraftCommand();
			await waitFor(
				() =>
					latest?.command === "" &&
					latest.draftCommand === "bun test" &&
					latest.saving === false,
				"saved draft waiting for restart",
			);

			expect(requests).toEqual([
				{
					body: JSON.stringify({ command: "bun test" }),
					method: "PATCH",
					url: "/api/agents/agent-a/terminal-run-command",
				},
			]);
			expect(restartCommands).toEqual([CONFIG_SAVE_RESTART_COMMAND]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("surfaces a restart request failure after saving a setup draft", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ command: "" }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		) as unknown as typeof fetch;

		let latest: Snapshot | undefined;
		const app = render(
			<Observer
				agentId="agent-a"
				runtimeCommand=""
				onSaveSucceeded={() => CONFIG_SAVE_RESTART_ERROR}
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr: createOutputStream(),
				stdin: new PassThrough() as unknown as NodeJS.ReadStream,
				stdout: createOutputStream(),
			},
		);

		try {
			await waitFor(() => latest?.command === "", "initial empty command");
			latest?.setDraftCommand("bun test");
			await waitFor(
				() => latest?.draftCommand === "bun test",
				"draft command update",
			);

			await latest?.saveDraftCommand();
			await waitFor(
				() =>
					latest?.error === CONFIG_SAVE_RESTART_ERROR &&
					latest.saving === false,
				"restart request failure",
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("shows configured state only when the restarted runtime summary carries the command", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ command: "" }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		) as unknown as typeof fetch;

		let latest: Snapshot | undefined;
		const app = render(
			<Observer
				agentId="agent-a"
				runtimeCommand=""
				onSnapshot={(snapshot) => {
					latest = snapshot;
				}}
			/>,
			{
				exitOnCtrlC: false,
				patchConsole: false,
				stderr: createOutputStream(),
				stdin: new PassThrough() as unknown as NodeJS.ReadStream,
				stdout: createOutputStream(),
			},
		);

		try {
			await waitFor(() => latest?.command === "", "initial empty command");
			latest?.setDraftCommand("bun test");
			await latest?.saveDraftCommand();
			await waitFor(
				() => latest?.command === "" && latest.draftCommand === "bun test",
				"saved draft before restart",
			);

			app.rerender(
				<Observer
					agentId="agent-a"
					runtimeCommand="bun test"
					onSnapshot={(snapshot) => {
						latest = snapshot;
					}}
				/>,
			);

			await waitFor(
				() =>
					latest?.command === "bun test" && latest.draftCommand === "bun test",
				"restarted runtime command",
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});

describe("resolveSavedTerminalRunCommand", () => {
	test("returns the saved command for header run clicks", () => {
		expect(resolveSavedTerminalRunCommand(" bun test ")).toBe("bun test");
	});

	test("returns null when no saved command exists", () => {
		expect(resolveSavedTerminalRunCommand("  ")).toBeNull();
	});
});

describe("resolveHeaderTerminalRunAction", () => {
	test("runs the saved command when it exists", () => {
		expect(
			resolveHeaderTerminalRunAction({
				command: " bun test ",
			}),
		).toEqual({ command: "bun test", type: "run" });
	});

	test("selects the run tab without executing when no command is saved", () => {
		expect(
			resolveHeaderTerminalRunAction({
				command: " ",
			}),
		).toEqual({ type: "select" });
	});
});
