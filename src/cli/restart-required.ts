import { join } from "node:path";
import { PidManager } from "../runtime/process/pid-manager.ts";

export const RESTART_REQUIRED_MESSAGE =
	"Restart required. Changes won't update until the runtime restarts.";

export function maybeMarkRestartRequired(homeDir: string): boolean {
	const pid = new PidManager(join(homeDir, "daemon.pid"));
	if (!pid.isRunning()) {
		return false;
	}

	console.log(RESTART_REQUIRED_MESSAGE);
	return true;
}
