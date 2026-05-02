import type { Dirent } from "node:fs";
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, parse, resolve } from "node:path";
import type {
	BrowserInboxArchiveResponse,
	BrowserInboxCreateNoteInput,
	BrowserInboxCreateNoteResponse,
	BrowserInboxItem,
	BrowserInboxItemLocation,
	BrowserInboxResponse,
	BrowserInboxRestoreResponse,
} from "../../../common/protocol.ts";
import {
	resolveExistingPathWithinRoot,
	resolveWithinRoot,
	toRelativePath,
} from "../paths/path-safety.ts";

const INBOX_DIR_NAME = "inbox";
const ARCHIVE_DIR_NAME = "archive";
const INBOX_IGNORED_FILE_NAMES = new Set([".DS_Store", ".gitkeep"]);

export async function listInboxEntries(
	agentRoot: string,
): Promise<BrowserInboxResponse> {
	const inboxDir = resolve(agentRoot, INBOX_DIR_NAME);
	const archiveDir = resolve(inboxDir, ARCHIVE_DIR_NAME);
	const items = await listDirectInboxFiles(agentRoot, inboxDir, "inbox");
	const archivedItems = await listDirectInboxFiles(
		agentRoot,
		archiveDir,
		"archive",
	);

	return {
		archivedItems,
		items,
		pendingCount: items.length,
	};
}

export async function archiveInboxItem(
	agentRoot: string,
	relativePath: string,
): Promise<BrowserInboxArchiveResponse> {
	const inboxDir = resolve(agentRoot, INBOX_DIR_NAME);
	const archiveDir = resolve(inboxDir, ARCHIVE_DIR_NAME);
	const sourcePath = await resolveDirectInboxFile(
		agentRoot,
		inboxDir,
		relativePath,
	);
	await mkdir(archiveDir, { recursive: true });
	const archivePath = await resolveAvailableChildPath(
		archiveDir,
		basename(sourcePath),
	);
	await rename(sourcePath, archivePath);

	return {
		archivedPath: toRelativePath(agentRoot, archivePath),
		item: await createInboxItem(agentRoot, archivePath, "archive"),
		originalPath: toRelativePath(agentRoot, sourcePath),
	};
}

export async function createInboxNote(
	agentRoot: string,
	input: BrowserInboxCreateNoteInput,
): Promise<BrowserInboxCreateNoteResponse> {
	const inboxDir = resolve(agentRoot, INBOX_DIR_NAME);
	const title = normalizeInboxNoteTitle(input.title);
	const body = input.body.trim();
	if (!title && !body) {
		throw new Error("Inbox note must include a title or body");
	}

	const noteTitle = title || "Inbox note";
	const notePath = await resolveAvailableChildPath(
		inboxDir,
		`${slugifyInboxNoteTitle(noteTitle)}.md`,
	);
	await mkdir(inboxDir, { recursive: true });
	await writeFile(notePath, formatInboxNoteContent(noteTitle, body), "utf8");

	return {
		item: await createInboxItem(agentRoot, notePath, "inbox"),
		path: toRelativePath(agentRoot, notePath),
	};
}

export async function restoreInboxItem(
	agentRoot: string,
	archivedPath: string,
	originalPath: string,
): Promise<BrowserInboxRestoreResponse> {
	const inboxDir = resolve(agentRoot, INBOX_DIR_NAME);
	const archiveDir = resolve(inboxDir, ARCHIVE_DIR_NAME);
	const sourcePath = await resolveDirectInboxFile(
		agentRoot,
		archiveDir,
		archivedPath,
	);
	const requestedRestorePath = resolveDirectInboxTarget(
		agentRoot,
		inboxDir,
		originalPath,
	);
	await mkdir(inboxDir, { recursive: true });
	const restorePath = await resolveAvailableChildPath(
		inboxDir,
		basename(requestedRestorePath),
	);
	await rename(sourcePath, restorePath);

	return {
		archivedPath: toRelativePath(agentRoot, sourcePath),
		item: await createInboxItem(agentRoot, restorePath, "inbox"),
		restoredPath: toRelativePath(agentRoot, restorePath),
	};
}

async function listDirectInboxFiles(
	agentRoot: string,
	dir: string,
	location: BrowserInboxItemLocation,
): Promise<BrowserInboxItem[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (isMissingPathError(error)) {
			return [];
		}
		throw error;
	}

	const files = await Promise.all(
		entries
			.filter(
				(entry) => entry.isFile() && !INBOX_IGNORED_FILE_NAMES.has(entry.name),
			)
			.map((entry) =>
				createInboxItem(agentRoot, resolve(dir, entry.name), location),
			),
	);

	return files.sort((left, right) => {
		const modifiedComparison =
			Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt);
		if (modifiedComparison !== 0) {
			return modifiedComparison;
		}
		return left.name.localeCompare(right.name);
	});
}

async function createInboxItem(
	agentRoot: string,
	absolutePath: string,
	location: BrowserInboxItemLocation,
): Promise<BrowserInboxItem> {
	const fileStat = await stat(absolutePath);
	return {
		location,
		modifiedAt: fileStat.mtime.toISOString(),
		name: basename(absolutePath),
		path: toRelativePath(agentRoot, absolutePath),
		size: fileStat.size,
	};
}

async function resolveDirectInboxFile(
	agentRoot: string,
	parentDir: string,
	relativePath: string,
): Promise<string> {
	const absolutePath = resolveExistingPathWithinRoot(agentRoot, relativePath);
	if (dirname(absolutePath) !== parentDir) {
		throw new Error("Path must reference a file directly in inbox");
	}
	const fileStat = await stat(absolutePath);
	if (!fileStat.isFile()) {
		throw new Error("Path does not reference a file");
	}
	return absolutePath;
}

function resolveDirectInboxTarget(
	agentRoot: string,
	parentDir: string,
	relativePath: string,
): string {
	const absolutePath = resolveWithinRoot(agentRoot, relativePath);
	if (dirname(absolutePath) !== parentDir) {
		throw new Error("Path must reference a file directly in inbox");
	}
	return absolutePath;
}

function normalizeInboxNoteTitle(title: string | undefined): string {
	return title?.trim().replace(/\s+/g, " ") ?? "";
}

function slugifyInboxNoteTitle(title: string): string {
	const slug = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "inbox-note";
}

function formatInboxNoteContent(title: string, body: string): string {
	return body ? `# ${title}\n\n${body}\n` : `# ${title}\n`;
}

async function resolveAvailableChildPath(
	parentDir: string,
	name: string,
): Promise<string> {
	const parsedName = parse(name);
	let suffix = 0;
	while (true) {
		const candidateName =
			suffix === 0 ? name : `${parsedName.name}-${suffix}${parsedName.ext}`;
		const candidatePath = resolve(parentDir, candidateName);
		if (!(await pathExists(candidatePath))) {
			return candidatePath;
		}
		suffix += 1;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

function isMissingPathError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}
