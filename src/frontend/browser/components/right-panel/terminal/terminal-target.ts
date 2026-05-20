import type { BrowserTerminalTarget } from "../../../../../common/protocol.ts";

export function createTerminalTarget(params: {
	scopeId: string;
	providerId?: string;
	repositoryId?: string;
	sdkSessionId?: string;
}): BrowserTerminalTarget {
	if (!params.repositoryId) {
		return { kind: "agent", agentId: params.scopeId };
	}
	return {
		kind: "coding",
		repositoryId: params.repositoryId,
		...(params.providerId ? { providerId: params.providerId } : {}),
		...(params.sdkSessionId ? { sdkSessionId: params.sdkSessionId } : {}),
	};
}
