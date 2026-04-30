import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
	MemoryFileCommandName,
	MemoryFileReference,
} from "../../common/protocol.ts";

export interface MemoryFileCommandDefinition {
	command: MemoryFileCommandName;
	rootPath: string;
	title: string;
}

const WORKING_FILE_NAMES = ["AGENTS.md", "USER.md", "SOUL.md", "MEMORY.md"];

const MEMORY_FILE_COMMANDS = new Map<string, MemoryFileCommandDefinition>([
	[
		"notes",
		{
			command: "notes",
			rootPath: "notes",
			title: "Notes",
		},
	],
	[
		"schema",
		{
			command: "schema",
			rootPath: "schemas",
			title: "Schemas",
		},
	],
	[
		"daily-memories",
		{
			command: "daily-memories",
			rootPath: "daily-memories",
			title: "Daily Memories",
		},
	],
	[
		"daily_memories",
		{
			command: "daily-memories",
			rootPath: "daily-memories",
			title: "Daily Memories",
		},
	],
	[
		"working-files",
		{
			command: "working-files",
			rootPath: ".",
			title: "Working Files",
		},
	],
	[
		"working_files",
		{
			command: "working-files",
			rootPath: ".",
			title: "Working Files",
		},
	],
]);

export function parseMemoryFileCommand(command: string):
	| {
			definition: MemoryFileCommandDefinition;
			selector: string;
	  }
	| undefined {
	const trimmed = command.trim();
	if (!trimmed.startsWith("/")) {
		return undefined;
	}

	const match = /^\/([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
	if (!match) {
		return undefined;
	}

	const rawCommand = match[1] ?? "";
	const definition = MEMORY_FILE_COMMANDS.get(rawCommand);
	if (!definition) {
		return undefined;
	}

	return {
		definition,
		selector: (match[2] ?? "").trim(),
	};
}

export function listMemoryFiles(
	memoryRoot: string,
	definition: MemoryFileCommandDefinition,
): MemoryFileReference[] {
	if (definition.command === "working-files") {
		return WORKING_FILE_NAMES.flatMap((name) => {
			const path = join(memoryRoot, name);
			if (!existsSync(path) || !statSync(path).isFile()) {
				return [];
			}
			return [createReference(definition.command, name, name)];
		});
	}

	const root = join(memoryRoot, definition.rootPath);
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		return [];
	}

	const files = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.filter((entry) => !entry.name.startsWith("."))
		.filter((entry) => !entry.name.startsWith("_"))
		.map((entry) =>
			createReference(
				definition.command,
				entry.name,
				`${definition.rootPath}/${entry.name}`,
			),
		);

	return files.sort((a, b) => {
		if (definition.command === "daily-memories") {
			return b.name.localeCompare(a.name);
		}
		return a.name.localeCompare(b.name);
	});
}

export function findMemoryFile(
	files: MemoryFileReference[],
	selector: string,
): MemoryFileReference | undefined {
	return files.find(
		(file) =>
			file.id === selector || file.path === selector || file.name === selector,
	);
}

function createReference(
	command: MemoryFileCommandName,
	name: string,
	path: string,
): MemoryFileReference {
	return {
		id: createFileId(command, path),
		name,
		path,
	};
}

function createFileId(command: MemoryFileCommandName, path: string): string {
	return createHash("sha256")
		.update(`${command}\0${path}`)
		.digest("hex")
		.slice(0, 16);
}
