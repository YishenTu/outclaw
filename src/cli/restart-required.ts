import { createOutclawLayout } from "../common/layout.ts";
import { PidManager } from "../runtime/process/pid-manager.ts";

export const RESTART_REQUIRED_MESSAGE =
	"Restart required. Changes won't update until the runtime restarts.";

export function maybeMarkRestartRequired(homeDir: string): boolean {
	const pid = new PidManager(createOutclawLayout({ homeDir }).pidPath);
	if (!pid.isRunning()) {
		return false;
	}

	console.log(RESTART_REQUIRED_MESSAGE);
	return true;
}
