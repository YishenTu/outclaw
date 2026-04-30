import { saveTelegramFile } from "./storage.ts";

export function buildTelegramFileUrl(token: string, filePath: string): string {
	return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

export function basenameFromPath(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	return slash >= 0 ? filePath.slice(slash + 1) : filePath;
}

export function extensionFromPath(filePath?: string): string | undefined {
	if (!filePath) {
		return undefined;
	}

	const dot = filePath.lastIndexOf(".");
	if (dot === -1 || dot === filePath.length - 1) {
		return undefined;
	}

	return filePath.slice(dot).toLowerCase();
}

export async function saveTelegramApiFile(params: {
	ext: string;
	filePath: string;
	filesRoot?: string;
	token: string;
}): Promise<{ path: string }> {
	if (!params.filesRoot) {
		throw new Error("Telegram files root is not configured");
	}

	return saveTelegramFile(
		params.filesRoot,
		buildTelegramFileUrl(params.token, params.filePath),
		params.ext,
	);
}
