import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function ensureGlobalEnvFile(homeDir: string) {
	const envPath = join(homeDir, ".env");
	if (!existsSync(envPath)) {
		writeFileSync(envPath, "");
	}
}
