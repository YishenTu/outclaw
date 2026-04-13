import { afterEach, describe, expect, mock, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";

const STARTUP_INFO_PATH = new URL(
	"../../../../src/frontend/tui/chrome/startup-info.ts",
	import.meta.url,
).pathname;

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

async function renderHeaderBar(options: {
	caseId: string;
	startupInfo: {
		git: {
			branch: string;
			dirty: boolean;
			summary: string;
			files: string[];
		} | null;
		missingFiles: string[];
	};
}) {
	mock.module("figlet", () => ({
		default: {
			textSync: () => "OUTCLAW",
		},
	}));
	mock.module(STARTUP_INFO_PATH, () => ({
		collectStartupInfo: () => options.startupInfo,
	}));

	const realRandom = Math.random;
	Math.random = () => 0;

	const { HeaderBar } = await import(
		`../../../../src/frontend/tui/chrome/header-bar.tsx?case=${options.caseId}`
	);

	const stdout = createOutputStream();
	const stderr = createOutputStream();
	const stdin = new PassThrough() as unknown as NodeJS.ReadStream & {
		isTTY: boolean;
	};
	stdin.isTTY = false;
	let output = "";
	stdout.on("data", (chunk) => {
		output = chunk.toString();
	});

	const app = render(<HeaderBar />, {
		debug: true,
		exitOnCtrlC: false,
		patchConsole: false,
		stderr,
		stdin,
		stdout,
	});

	await flushUpdates();
	Math.random = realRandom;

	return {
		app,
		getOutput: () => output,
	};
}

describe("HeaderBar", () => {
	afterEach(() => {
		mock.module("figlet", () => ({
			default: {
				textSync: () => "OUTCLAW",
			},
		}));
	});

	test("shows the setup hint when no git repo is available and files are missing", async () => {
		const { app, getOutput } = await renderHeaderBar({
			caseId: "missing",
			startupInfo: {
				git: null,
				missingFiles: ["AGENTS.md", "SOUL.md"],
			},
		});

		try {
			const output = getOutput();
			expect(output).toContain("OUTCLAW");
			expect(output).toContain("WANTED: DEAD BUGS OR ALIVE FEATURES");
			expect(output).toContain("tip: git init ~/.outclaw to track");
			expect(output).toContain("config changes");
			expect(output).toContain("missing: AGENTS.md, SOUL.md");
			expect(output).toContain("run oc start");
			expect(output).toContain("to initialize");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});

	test("shows dirty git details and a healthy file state when startup files exist", async () => {
		const { app, getOutput } = await renderHeaderBar({
			caseId: "dirty",
			startupInfo: {
				git: {
					branch: "main",
					dirty: true,
					summary: "2 changed",
					files: ["AGENTS.md", "config.json"],
				},
				missingFiles: [],
			},
		});

		try {
			const output = getOutput();
			expect(output).toContain("main");
			expect(output).toContain("2 changed");
			expect(output).toContain("files ok");
			expect(output).toContain("AGENTS.md");
			expect(output).toContain("config.json");
		} finally {
			app.unmount();
			app.cleanup();
		}
	});
});
