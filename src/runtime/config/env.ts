import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function loadSharedEnv(homeDir: string): void {
	const envPath = join(homeDir, ".env");
	if (!existsSync(envPath)) return;

	const content = readFileSync(envPath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		const value = trimmed.slice(eqIdx + 1).trim();
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}

export function resolveEnvString(value: string): string {
	if (value.startsWith("$")) {
		return process.env[value.slice(1)] ?? "";
	}
	return value;
}

export function resolveAllowedUsers(value: unknown): number[] {
	if (Array.isArray(value)) {
		return value.filter((entry): entry is number => typeof entry === "number");
	}

	if (typeof value === "string") {
		const resolved = resolveEnvString(value);
		if (!resolved) return [];
		return resolved
			.split(",")
			.map((entry) => Number(entry.trim()))
			.filter((entry) => Number.isFinite(entry) && entry !== 0);
	}

	return [];
}

export function resolveOptionalUserId(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) && value !== 0 ? value : undefined;
	}

	if (typeof value === "string") {
		const resolved = resolveEnvString(value).trim();
		if (!resolved) {
			return undefined;
		}
		const parsed = Number(resolved);
		return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
	}

	return undefined;
}

export function upsertSharedEnvEntries(
	homeDir: string,
	entries: Record<string, string>,
): void {
	const envPath = join(homeDir, ".env");
	const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : "";
	const lines = existing === "" ? [] : existing.split(/\r?\n/);
	const nextLines: string[] = [];
	const remaining = new Map(Object.entries(entries));

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) {
			nextLines.push(line);
			continue;
		}

		const eqIdx = line.indexOf("=");
		if (eqIdx === -1) {
			nextLines.push(line);
			continue;
		}

		const key = line.slice(0, eqIdx).trim();
		if (!remaining.has(key)) {
			nextLines.push(line);
			continue;
		}

		nextLines.push(`${key}=${remaining.get(key) ?? ""}`);
		remaining.delete(key);
	}

	for (const [key, value] of remaining) {
		nextLines.push(`${key}=${value}`);
	}

	const content = nextLines.filter((line, index, all) => {
		return !(line === "" && index === all.length - 1);
	});
	writeFileSync(envPath, `${content.join("\n").replace(/\n+$/, "")}\n`);
}
