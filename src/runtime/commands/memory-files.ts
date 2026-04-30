import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientHub, WsClient } from "../transport/client-hub.ts";
import {
	findMemoryFile,
	listMemoryFiles,
	parseMemoryFileCommand,
} from "./memory-file-read-model.ts";

interface HandleMemoryFileCommandOptions {
	command: string;
	hub: ClientHub;
	promptHomeDir?: string;
	ws: WsClient;
}

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
