import type { BrowserTerminalTarget } from "../../common/protocol.ts";
import type { BrowserApi } from "./browser-api-router.ts";

export function resolveBrowserTerminalCwd(
	target: BrowserTerminalTarget,
	browserApi: BrowserApi | undefined,
): { cwd?: string; error?: string } {
	if (!browserApi) {
		return { error: "Browser terminal API is not configured" };
	}
	try {
		if (target.kind === "coding") {
			const cwd = browserApi.getCodingRepositoryCwd?.(target.repositoryId, {
				...(target.providerId ? { providerId: target.providerId } : {}),
				...(target.sdkSessionId ? { sdkSessionId: target.sdkSessionId } : {}),
			});
			return cwd
				? { cwd }
				: { error: "Coding repository terminal workspace is not available" };
		}

		const cwd = browserApi.getAgentTerminalCwd(target.agentId);
		return cwd
			? { cwd }
			: { error: "Agent terminal workspace is not available" };
	} catch (error) {
		return { error: formatError(error) };
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
