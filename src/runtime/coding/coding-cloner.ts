import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type CodingCloneResult =
	| {
			status: "cloned";
			rootCwd: string;
			displayName: string;
	  }
	| {
			status: "failed";
			message: string;
	  };

export interface CodingCloneRequest {
	remoteUrl: string;
	parentDir: string;
	displayName?: string;
}

export type CodingCloner = (
	request: CodingCloneRequest,
) => Promise<CodingCloneResult>;

interface ClonerSpawnResult {
	exitCode: number | null;
	stderr: string;
}

type ClonerSpawn = (command: string[]) => Promise<ClonerSpawnResult>;

const defaultSpawn: ClonerSpawn = async (command) => {
	const proc = Bun.spawn(command, {
		stderr: "pipe",
		stdout: "pipe",
	});
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { exitCode, stderr };
};

interface CreateGitClonerOptions {
	gitCommand?: string;
	spawn?: ClonerSpawn;
	ensureDir?: (dir: string) => void;
	exists?: (path: string) => boolean;
}

export function createGitCloner(
	options: CreateGitClonerOptions = {},
): CodingCloner {
	const gitCommand = options.gitCommand ?? "git";
	const spawn = options.spawn ?? defaultSpawn;
	const ensureDir =
		options.ensureDir ?? ((dir: string) => mkdirSync(dir, { recursive: true }));
	const exists = options.exists ?? ((path: string) => existsSync(path));

	return async ({ remoteUrl, parentDir, displayName }) => {
		const trimmedUrl = remoteUrl.trim();
		if (trimmedUrl === "") {
			return { status: "failed", message: "Remote URL is required" };
		}
		const trimmedParent = parentDir.trim();
		if (trimmedParent === "" || !isAbsolute(trimmedParent)) {
			return {
				status: "failed",
				message: "Parent directory must be an absolute path",
			};
		}

		const derivedName =
			displayName?.trim() || deriveRepoNameFromUrl(trimmedUrl);
		if (!derivedName) {
			return {
				status: "failed",
				message: `Could not derive a folder name from "${trimmedUrl}"`,
			};
		}
		const target = resolve(trimmedParent, derivedName);
		if (exists(target)) {
			return {
				status: "failed",
				message: `Target directory already exists: ${target}`,
			};
		}

		try {
			ensureDir(trimmedParent);
		} catch (error) {
			return {
				status: "failed",
				message:
					error instanceof Error
						? `Failed to prepare parent directory: ${error.message}`
						: `Failed to prepare parent directory: ${String(error)}`,
			};
		}

		let result: ClonerSpawnResult;
		try {
			result = await spawn([gitCommand, "clone", trimmedUrl, target]);
		} catch (error) {
			return {
				status: "failed",
				message:
					error instanceof Error
						? `Failed to launch ${gitCommand}: ${error.message}`
						: `Failed to launch ${gitCommand}`,
			};
		}
		if (result.exitCode === 0) {
			return { status: "cloned", rootCwd: target, displayName: derivedName };
		}
		const stderr = result.stderr.trim();
		const reason =
			stderr.length > 0
				? stderr
				: `git clone exited with code ${result.exitCode ?? "unknown"}`;
		return { status: "failed", message: reason };
	};
}

export function deriveRepoNameFromUrl(url: string): string {
	const stripped = url.replace(/\.git\/?$/i, "").replace(/\/+$/, "");
	const lastSlash = stripped.lastIndexOf("/");
	const lastColon = stripped.lastIndexOf(":");
	const cut = Math.max(lastSlash, lastColon);
	const tail = cut >= 0 ? stripped.slice(cut + 1) : stripped;
	return tail.trim();
}
