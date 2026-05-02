import { lstatSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export function resolveWithinRoot(rootDir: string, targetPath: string): string {
	if (targetPath.trim() === "") {
		throw new Error("Path is required");
	}

	const resolvedRoot = resolve(rootDir);
	const resolvedTarget = resolve(resolvedRoot, targetPath);
	if (
		resolvedTarget !== resolvedRoot &&
		!resolvedTarget.startsWith(`${resolvedRoot}${sep}`)
	) {
		throw new Error("Path escapes agent home");
	}
	return resolvedTarget;
}

export function resolveExistingPathWithinRoot(
	rootDir: string,
	targetPath: string,
): string {
	const resolvedTarget = resolveWithinRoot(rootDir, targetPath);
	assertExistingPathWithinDirectory(
		rootDir,
		resolvedTarget,
		"Path escapes agent home",
	);
	return resolvedTarget;
}

export function resolveWritablePathWithinRoot(
	rootDir: string,
	targetPath: string,
): string {
	const resolvedTarget = resolveWithinRoot(rootDir, targetPath);
	if (pathExistsForResolutionPolicy(resolvedTarget)) {
		assertExistingPathWithinDirectory(
			rootDir,
			resolvedTarget,
			"Path escapes agent home",
		);
		return resolvedTarget;
	}

	assertExistingPathWithinDirectory(
		rootDir,
		dirname(resolvedTarget),
		"Path escapes agent home",
	);
	return resolvedTarget;
}

export function resolveWithinCronDirectory(
	rootDir: string,
	targetPath: string,
): string {
	const cronDir = resolve(rootDir, "cron");
	const resolvedTarget = resolveWithinRoot(rootDir, targetPath);
	if (
		resolvedTarget !== cronDir &&
		!resolvedTarget.startsWith(`${cronDir}${sep}`)
	) {
		throw new Error("Path escapes cron directory");
	}

	return resolvedTarget;
}

export function resolveExistingPathWithinCronDirectory(
	rootDir: string,
	targetPath: string,
): string {
	const cronDir = resolve(rootDir, "cron");
	const resolvedTarget = resolveWithinCronDirectory(rootDir, targetPath);
	assertExistingPathWithinDirectory(
		cronDir,
		resolvedTarget,
		"Path escapes cron directory",
	);
	assertExistingPathWithinDirectory(
		rootDir,
		resolvedTarget,
		"Path escapes agent home",
	);
	return resolvedTarget;
}

export function toRelativePath(rootDir: string, absolutePath: string): string {
	return relative(rootDir, absolutePath).split(sep).join("/");
}

export function toRelativeDescendantPath(
	rootDir: string,
	absolutePath: string,
): string | undefined {
	const resolvedRoot = resolve(rootDir);
	const resolvedTarget = resolve(absolutePath);
	if (resolvedTarget === resolvedRoot) {
		return "";
	}
	if (!resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
		return undefined;
	}
	return relative(resolvedRoot, resolvedTarget).split(sep).join("/");
}

export function normalizeBrowserPath(path: string): string {
	return path.split(sep).join("/").replace(/\/+$/, "");
}

function assertExistingPathWithinDirectory(
	rootDir: string,
	targetPath: string,
	errorMessage: string,
) {
	const realRoot = realpathForResolutionPolicy(rootDir, errorMessage);
	const realTarget = realpathForResolutionPolicy(targetPath, errorMessage);
	if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${sep}`)) {
		throw new Error(errorMessage);
	}
}

function pathExistsForResolutionPolicy(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

function realpathForResolutionPolicy(
	path: string,
	errorMessage: string,
): string {
	try {
		return realpathSync.native(path);
	} catch {
		throw new Error(errorMessage);
	}
}

function isMissingPathError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}
