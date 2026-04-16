import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { useState } from "react";
import { SessionMenu } from "../../../../src/frontend/tui/sessions/menu.tsx";
import type { SessionMenuChoice } from "../../../../src/frontend/tui/sessions/types.ts";

const CHOICES: SessionMenuChoice[] = [
	{
		sdkSessionId: "sdk-alpha",
		title: "Alpha session",
		model: "opus",
		lastActive: Date.now() - 1_000,
		active: true,
	},
	{
		sdkSessionId: "sdk-beta",
		title: "Beta session",
		model: "sonnet",
		lastActive: Date.now() - 2_000,
		active: false,
	},
	{
		sdkSessionId: "sdk-gamma",
		title: "Gamma session",
		model: "haiku",
		lastActive: Date.now() - 3_000,
		active: false,
	},
];

const DRAFT_CHOICE: SessionMenuChoice = {
	sdkSessionId: "sdk-alpha",
	title: "  Draft title  ",
	model: "opus",
	lastActive: Date.now() - 1_000,
	active: true,
};

function createOutputStream(columns = 80) {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = columns;
	stream.isTTY = false;
	stream.rows = 24;
	return stream;
}

type TestStdin = PassThrough &
	NodeJS.ReadStream & {
		isTTY: boolean;
	};

async function flushUpdates() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

async function sendInput(stdin: TestStdin, sequence: string) {
	stdin.write(sequence);
	await flushUpdates();
}

function renderMenu(props: {
	choices?: SessionMenuChoice[];
	onDelete?: (choice: SessionMenuChoice) => void;
	onDismiss?: () => void;
	onRename?: (choice: SessionMenuChoice, title: string) => void;
	onSelect?: (choice: SessionMenuChoice) => void;
}) {
	const stdout = createOutputStream();
	const stderr = createOutputStream();
	const stdin = new PassThrough() as TestStdin;
	stdin.isTTY = false;

	const app = render(
		<SessionMenu
			choices={props.choices ?? CHOICES}
			onSelect={props.onSelect ?? (() => undefined)}
			onDelete={props.onDelete ?? (() => undefined)}
			onRename={props.onRename ?? (() => undefined)}
			onDismiss={props.onDismiss ?? (() => undefined)}
		/>,
		{
			exitOnCtrlC: false,
			patchConsole: false,
			stderr,
			stdin,
			stdout,
		},
	);

	return { app, stdin };
}

describe("SessionMenu", () => {
	test("wraps the cursor with arrow navigation before selecting", async () => {
		const selected: string[] = [];
		const { app, stdin } = renderMenu({
			onSelect: (choice) => {
				selected.push(choice.sdkSessionId);
			},
		});

		try {
			await flushUpdates();
			await sendInput(stdin, "\u001B[A");
			await sendInput(stdin, "\r");
			await sendInput(stdin, "\u001B[B");
			await sendInput(stdin, "\r");

			expect(selected).toEqual(["sdk-gamma", "sdk-alpha"]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("applies navigation before Enter within one batch", async () => {
		const selected: string[] = [];
		const { app, stdin } = renderMenu({
			onSelect: (choice) => {
				selected.push(choice.sdkSessionId);
			},
		});

		try {
			await flushUpdates();
			await sendInput(stdin, "\u001B[A\r");

			expect(selected).toEqual(["sdk-gamma"]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("invokes delete for the currently selected session", async () => {
		const deleted: string[] = [];
		const { app, stdin } = renderMenu({
			onDelete: (choice) => {
				deleted.push(choice.sdkSessionId);
			},
		});

		try {
			await flushUpdates();
			await sendInput(stdin, "d");

			expect(deleted).toEqual(["sdk-alpha"]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("submits trimmed rename values and exits rename mode", async () => {
		const renamed: Array<{ sdkSessionId: string; title: string }> = [];
		const { app, stdin } = renderMenu({
			choices: [DRAFT_CHOICE],
			onRename: (choice, title) => {
				renamed.push({ sdkSessionId: choice.sdkSessionId, title });
			},
		});

		try {
			await flushUpdates();
			await sendInput(stdin, "r");
			await sendInput(stdin, "\r");
			await sendInput(stdin, "\r");

			expect(renamed).toEqual([
				{ sdkSessionId: "sdk-alpha", title: "Draft title" },
			]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("cancels rename on escape and restores menu controls", async () => {
		const selected: string[] = [];
		const renamed: string[] = [];
		const { app, stdin } = renderMenu({
			onSelect: (choice) => {
				selected.push(choice.sdkSessionId);
			},
			onRename: (_choice, title) => {
				renamed.push(title);
			},
		});

		try {
			await flushUpdates();
			await sendInput(stdin, "r");
			await sendInput(stdin, "\u001B");
			await sendInput(stdin, "\r");

			expect(renamed).toEqual([]);
			expect(selected).toEqual(["sdk-alpha"]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("dismisses an empty menu on escape", async () => {
		let dismissed = 0;
		const { app, stdin } = renderMenu({
			choices: [],
			onDismiss: () => {
				dismissed += 1;
			},
		});

		try {
			await flushUpdates();
			await sendInput(stdin, "\u001B");

			expect(dismissed).toBe(1);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("clamps the cursor when the last visible session is removed", async () => {
		const selected: string[] = [];

		function StatefulMenu() {
			const [choices, setChoices] = useState(CHOICES);
			return (
				<SessionMenu
					choices={choices}
					onSelect={(choice) => {
						selected.push(choice.sdkSessionId);
					}}
					onDelete={(choice) => {
						setChoices((current) =>
							current.filter(
								(session) => session.sdkSessionId !== choice.sdkSessionId,
							),
						);
					}}
					onRename={() => undefined}
					onDismiss={() => undefined}
				/>
			);
		}

		const stdout = createOutputStream();
		const stderr = createOutputStream();
		const stdin = new PassThrough() as TestStdin;
		stdin.isTTY = false;

		const app = render(<StatefulMenu />, {
			exitOnCtrlC: false,
			patchConsole: false,
			stderr,
			stdin,
			stdout,
		});

		try {
			await flushUpdates();
			await sendInput(stdin, "\u001B[A");
			await sendInput(stdin, "d");
			await sendInput(stdin, "\r");

			expect(selected).toEqual(["sdk-beta"]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
