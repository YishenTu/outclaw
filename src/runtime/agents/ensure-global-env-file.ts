import { existsSync, writeFileSync } from "node:fs";
import { createOutclawLayout } from "../../common/layout.ts";

export function ensureGlobalEnvFile(homeDir: string) {
	const envPath = createOutclawLayout({ homeDir }).envPath;
	if (!existsSync(envPath)) {
		writeFileSync(envPath, "");
	}
}
