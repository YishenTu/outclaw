import { join } from "node:path";

const HEARTBEAT_FILE = "HEARTBEAT.md";

function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isFullLineHtmlComment(line: string): boolean {
	const trimmed = line.trim();
	return /^<!--.*-->$/.test(trimmed);
}

function cleanHeartbeatPrompt(content: string): string {
	return content
		.split("\n")
		.filter((line) => !isFullLineHtmlComment(line))
		.join("\n")
		.trim();
}

export async function readHeartbeatPrompt(
	promptHomeDir: string,
): Promise<string | undefined> {
	try {
		const content = await Bun.file(join(promptHomeDir, HEARTBEAT_FILE)).text();
		const cleaned = cleanHeartbeatPrompt(content);
		return cleaned === "" ? undefined : cleaned;
	} catch (error) {
		if (isMissingFile(error)) {
			return undefined;
		}
		throw error;
	}
}
