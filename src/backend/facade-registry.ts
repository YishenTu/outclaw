import type { Facade } from "../common/protocol.ts";
import { ClaudeAdapter } from "./adapters/claude/index.ts";
import { CodexAdapter } from "./adapters/codex/index.ts";
import { PiAdapter } from "./adapters/pi/index.ts";

export function createFacadeForProvider(
	providerId: string,
): Facade | undefined {
	switch (providerId) {
		case "claude":
			return new ClaudeAdapter();
		case "codex":
			return new CodexAdapter();
		case "pi":
			return new PiAdapter();
		default:
			return undefined;
	}
}
