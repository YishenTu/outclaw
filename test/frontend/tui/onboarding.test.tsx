import { afterEach, describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { AgentOnboardingSubmission } from "../../../src/frontend/tui/onboarding/index.tsx";
import { AgentOnboardingApp } from "../../../src/frontend/tui/onboarding/index.tsx";

function createOutputStream(rows = 24) {
	const stream = new PassThrough() as PassThrough &
		NodeJS.WriteStream & {
			columns: number;
			isTTY: boolean;
			rows: number;
		};
	stream.columns = 80;
	stream.isTTY = false;
	stream.rows = rows;
	return stream;
}

async function flushUpdates() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

async function renderOnboarding(existingCount = 0) {
	const stdout = createOutputStream();
	const stderr = createOutputStream();
	const stdin = new PassThrough() as PassThrough & {
		isTTY: boolean;
		ref: () => PassThrough;
		setRawMode: (value: boolean) => void;
		unref: () => PassThrough;
	};
	stdin.isTTY = true;
	stdin.ref = () => stdin;
	stdin.setRawMode = () => {};
	stdin.unref = () => stdin;
	const frames: string[] = [];
	const submissions: AgentOnboardingSubmission[] = [];

	stdout.on("data", (chunk) => {
		frames.push(chunk.toString());
	});

	const app = render(
		<AgentOnboardingApp
			existingCount={existingCount}
			onSubmit={(submission) => {
				submissions.push(submission);
			}}
		/>,
		{
			debug: true,
			exitOnCtrlC: false,
			patchConsole: false,
			stderr,
			stdin: stdin as unknown as NodeJS.ReadStream & {
				isTTY: boolean;
				ref: () => PassThrough;
				setRawMode: (value: boolean) => void;
				unref: () => PassThrough;
			},
			stdout,
		},
	);

	await flushUpdates();

	return {
		app,
		stdin,
		getOutput: () => frames.at(-1) ?? "",
		submissions,
	};
}

async function typeText(stdin: PassThrough, value: string) {
	stdin.write(value);
	await flushUpdates();
}

async function pressEnter(stdin: PassThrough) {
	stdin.write("\r");
	await flushUpdates();
}

async function pressDown(stdin: PassThrough) {
	stdin.write("\u001B[B");
	await flushUpdates();
}

describe("AgentOnboardingApp", () => {
	afterEach(() => {
		// Ink cleanup happens per test.
	});

	test("quick onboarding still requires a real agent name and submits agent-only defaults", async () => {
		const { app, getOutput, stdin, submissions } = await renderOnboarding(2);

		try {
			await pressEnter(stdin);
			expect(getOutput()).toContain("Agent name");

			await typeText(stdin, "railly");
			await pressEnter(stdin);
			expect(getOutput()).toContain("Browser access mode");

			await pressEnter(stdin);
			expect(getOutput()).toContain("Apply and restart?");

			await pressEnter(stdin);

			expect(submissions).toEqual([
				{
					enableLan: false,
					mode: "quick",
					name: "railly",
					scope: "agent",
				},
			]);
			expect(getOutput()).toContain("you have 2 agents");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("agent plus telegram onboarding validates the real agent-name contract before continuing", async () => {
		const { app, getOutput, stdin, submissions } = await renderOnboarding();

		try {
			await pressDown(stdin);
			await pressEnter(stdin);
			expect(getOutput()).toContain("Agent name");

			await typeText(stdin, "Railly");
			await pressEnter(stdin);

			expect(submissions).toEqual([]);
			expect(getOutput()).toContain(
				"use lowercase letters, digits, and single hyphens only",
			);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("agent plus telegram onboarding can collect Telegram settings and post-setup choices", async () => {
		const { app, stdin, submissions } = await renderOnboarding(1);

		try {
			await pressDown(stdin);
			await pressEnter(stdin);
			await typeText(stdin, "railly");
			await pressEnter(stdin);
			await typeText(stdin, "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
			await pressEnter(stdin);
			await typeText(stdin, "2, 1");
			await pressEnter(stdin);
			await pressEnter(stdin);
			await pressEnter(stdin);
			await pressEnter(stdin);

			expect(submissions).toEqual([
				{
					allowedUsers: [2, 1],
					botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ",
					enableLan: false,
					mode: "full",
					name: "railly",
					secureTelegramConfig: true,
					scope: "agent+telegram",
				},
			]);
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
