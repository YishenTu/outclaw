import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildBrowserFrontend,
	ensureBrowserBuild,
} from "../../src/cli/browser-build.ts";

function createLayout() {
	const root = mkdtempSync(join(tmpdir(), "outclaw-browser-build-"));
	const browserDir = join(root, "src", "frontend", "browser");
	const assetsDir = join(root, "assets");
	mkdirSync(join(browserDir, "src"), { recursive: true });
	mkdirSync(assetsDir, { recursive: true });
	writeFileSync(join(browserDir, "package.json"), "{}\n");
	writeFileSync(
		join(browserDir, "src", "main.tsx"),
		"console.log('browser');\n",
	);
	writeFileSync(join(assetsDir, "logo.png"), "png\n");
	return { assetsDir, browserDir, root };
}

describe("ensureBrowserBuild", () => {
	let tempRoot: string | undefined;

	afterEach(() => {
		if (tempRoot && existsSync(tempRoot)) {
			rmSync(tempRoot, { force: true, recursive: true });
		}
		tempRoot = undefined;
	});

	test("builds the browser bundle when dist is missing", () => {
		const { browserDir, root } = createLayout();
		tempRoot = root;
		const spawnSync = mock(() => ({ exitCode: 0 }) as never);
		const log = mock((_message: string) => undefined);

		ensureBrowserBuild(
			{
				browserDir,
			},
			{
				env: { BUN_ENV: "test" },
				log,
				spawnSync,
			},
		);

		expect(log).toHaveBeenCalledWith("Building browser frontend...");
		expect(spawnSync).toHaveBeenCalledWith(["bun", "run", "build"], {
			cwd: browserDir,
			env: { BUN_ENV: "test" },
			stdio: ["inherit", "inherit", "inherit"],
		});
	});

	test("skips rebuilding when the existing dist bundle is present", () => {
		const { browserDir, root } = createLayout();
		tempRoot = root;
		const distDir = join(browserDir, "dist", "assets");
		mkdirSync(distDir, { recursive: true });
		const builtFile = join(distDir, "index.js");
		writeFileSync(join(browserDir, "dist", "index.html"), "<html></html>\n");
		writeFileSync(builtFile, "bundle\n");
		const spawnSync = mock(() => ({ exitCode: 0 }) as never);

		ensureBrowserBuild(
			{
				browserDir,
			},
			{
				env: {},
				log: mock((_message: string) => undefined),
				spawnSync,
			},
		);

		expect(spawnSync).not.toHaveBeenCalled();
	});

	test("throws when the browser build command fails", () => {
		const { browserDir, root } = createLayout();
		tempRoot = root;
		const spawnSync = mock(() => ({ exitCode: 1 }) as never);

		expect(() =>
			ensureBrowserBuild(
				{
					browserDir,
				},
				{
					env: {},
					log: mock((_message: string) => undefined),
					spawnSync,
				},
			),
		).toThrow("Browser frontend build failed");
	});
});

describe("buildBrowserFrontend", () => {
	let tempRoot: string | undefined;

	afterEach(() => {
		if (tempRoot && existsSync(tempRoot)) {
			rmSync(tempRoot, { force: true, recursive: true });
		}
		tempRoot = undefined;
	});

	test("always builds even when dist already exists", () => {
		const { browserDir, root } = createLayout();
		tempRoot = root;
		mkdirSync(join(browserDir, "dist"), { recursive: true });
		writeFileSync(join(browserDir, "dist", "index.html"), "<html></html>\n");
		const spawnSync = mock(() => ({ exitCode: 0 }) as never);

		buildBrowserFrontend(
			{
				browserDir,
			},
			{
				env: {},
				log: mock((_message: string) => undefined),
				spawnSync,
			},
		);

		expect(spawnSync).toHaveBeenCalledTimes(1);
	});
});
