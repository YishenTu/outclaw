import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findMemoryFile,
	listMemoryFiles,
	parseMemoryFileCommand,
} from "../../../src/runtime/commands/memory-file-read-model.ts";

describe("memory file read model", () => {
	let tempRoot: string | undefined;

	afterEach(() => {
		if (tempRoot) {
			rmSync(tempRoot, { recursive: true, force: true });
		}
		tempRoot = undefined;
	});

	function createRoot() {
		tempRoot = mkdtempSync(join(tmpdir(), "outclaw-memory-files-"));
		return tempRoot;
	}

	test("parses canonical and Telegram-safe command aliases", () => {
		expect(
			parseMemoryFileCommand("/daily_memories 2026-04-29.md"),
		).toMatchObject({
			definition: {
				command: "daily-memories",
				rootPath: "daily-memories",
				title: "Daily Memories",
			},
			selector: "2026-04-29.md",
		});
		expect(parseMemoryFileCommand("notes")).toBeUndefined();
		expect(parseMemoryFileCommand("/unknown")).toBeUndefined();
	});

	test("lists allowed working files and hides hidden/template memory files", () => {
		const root = createRoot();
		writeFileSync(join(root, "AGENTS.md"), "agents");
		writeFileSync(join(root, "random.md"), "random");
		mkdirSync(join(root, "notes"));
		writeFileSync(join(root, "notes", "todo.md"), "todo");
		writeFileSync(join(root, "notes", ".hidden.md"), "hidden");
		writeFileSync(join(root, "notes", "_template.md"), "template");

		const workingDefinition =
			parseMemoryFileCommand("/working-files")?.definition;
		const notesDefinition = parseMemoryFileCommand("/notes")?.definition;
		if (!workingDefinition || !notesDefinition) {
			throw new Error("missing memory command definition");
		}

		expect(listMemoryFiles(root, workingDefinition)).toEqual([
			expect.objectContaining({ name: "AGENTS.md", path: "AGENTS.md" }),
		]);
		expect(listMemoryFiles(root, notesDefinition)).toEqual([
			expect.objectContaining({ name: "todo.md", path: "notes/todo.md" }),
		]);
	});

	test("sorts daily memories newest first and finds by id, path, or name", () => {
		const root = createRoot();
		mkdirSync(join(root, "daily-memories"));
		writeFileSync(join(root, "daily-memories", "2026-04-28.md"), "old");
		writeFileSync(join(root, "daily-memories", "2026-04-29.md"), "new");
		const definition = parseMemoryFileCommand("/daily-memories")?.definition;
		if (!definition) {
			throw new Error("missing daily memory definition");
		}

		const files = listMemoryFiles(root, definition);
		expect(files.map((file) => file.name)).toEqual([
			"2026-04-29.md",
			"2026-04-28.md",
		]);
		expect(findMemoryFile(files, "daily-memories/2026-04-28.md")?.name).toBe(
			"2026-04-28.md",
		);
		expect(findMemoryFile(files, "2026-04-29.md")?.path).toBe(
			"daily-memories/2026-04-29.md",
		);
		expect(findMemoryFile(files, files[0]?.id ?? "")).toBe(files[0]);
	});
});
