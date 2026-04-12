import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { TelegramFileRefStore } from "./telegram-file-ref-store.ts";

export function migrateLegacyTelegramFilesRoot(params: {
	legacyRoot: string;
	filesRoot: string;
	store: TelegramFileRefStore;
}) {
	const legacyRoot = resolve(params.legacyRoot);
	const filesRoot = resolve(params.filesRoot);

	if (legacyRoot === filesRoot) {
		return;
	}

	if (existsSync(legacyRoot)) {
		if (!existsSync(filesRoot)) {
			renameSync(legacyRoot, filesRoot);
		} else {
			cpSync(legacyRoot, filesRoot, {
				recursive: true,
				force: false,
				errorOnExist: false,
			});
			rmSync(legacyRoot, { recursive: true, force: true });
		}
	}

	params.store.rewriteRoot(legacyRoot, filesRoot);
}
