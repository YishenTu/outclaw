import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
	MemoryFileCommandName,
	MemoryFileReference,
} from "../../common/protocol.ts";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";

interface MemoryFileCommandDefinition {
	command: MemoryFileCommandName;
	rootPath: string;
	title: string;
}

interface HandleMemoryFileCommandOptions {
	command: string;
	hub: ClientHub;
	promptHomeDir?: string;
	ws: WsClient;
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

export function isMemoryFileCommand(command: string): boolean {
	return parseMemoryFileCommand(command) !== undefined;
}

export function handleMemoryFileCommand(
	options: HandleMemoryFileCommandOptions,
): boolean {
	const parsed = parseMemoryFileCommand(options.command);
	if (!parsed) {
		return false;
	}

	if (options.ws.data.clientType !== "telegram") {
		options.hub.send(options.ws, {
			type: "error",
			message: "Memory file commands are Telegram-only",
		});
		return true;
	}

	if (!options.promptHomeDir) {
		options.hub.send(options.ws, {
			type: "error",
			message: "Memory files are unavailable for this runtime",
		});
		return true;
	}

	const files = listMemoryFiles(options.promptHomeDir, parsed.definition);
	if (!parsed.selector) {
		options.hub.send(options.ws, {
			type: "memory_file_menu",
			command: parsed.definition.command,
			title: parsed.definition.title,
			rootPath: parsed.definition.rootPath,
			files,
		});
		return true;
	}

	const file = findMemoryFile(files, parsed.selector);
	if (!file) {
		options.hub.send(options.ws, {
			type: "error",
			message: `Memory file not found: ${parsed.selector}`,
		});
		return true;
	}

	options.hub.send(options.ws, {
		type: "memory_file_content",
		command: parsed.definition.command,
		name: file.name,
		path: file.path,
		content: readFileSync(join(options.promptHomeDir, file.path), "utf-8"),
	});
	return true;
}

function parseMemoryFileCommand(command: string):
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

function listMemoryFiles(
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

function findMemoryFile(
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
