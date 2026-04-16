import type { Facade } from "../common/protocol.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";

export function createFacadeForProvider(
	providerId: string,
): Facade | undefined {
	switch (providerId) {
		case "claude":
			return new ClaudeAdapter();
		default:
			return undefined;
	}
}
