import type { AgentRecord } from "../../runtime/agents/config/agent-record.ts";
import type { SessionRow } from "../../runtime/persistence/session-store/session-store.ts";
import {
	createAgentNameMap,
	createDisplayIds,
	formatTimestamp,
	sanitizeTitle,
} from "./session-read-model.ts";

export function formatFailedCronStatus(
	sessions: SessionRow[],
	agents: AgentRecord[],
): string {
	const agentNames = createAgentNameMap(agents);
	const ids = createDisplayIds(sessions.map((session) => session.sdkSessionId));
	const rows = sessions.map((session, index) =>
		[
			agentNames.get(session.agentId) ?? session.agentId,
			sanitizeTitle(session.title),
			ids[index],
			formatTimestamp(session.failedAt ?? session.lastActive),
			formatFailureMessage(session.failureMessage),
		].join("\t"),
	);

	return [
		["agent", "job", "id", "failed_at", "error"].join("\t"),
		...rows,
	].join("\n");
}

export function formatFailedCronNames(sessions: SessionRow[]): string {
	const names = new Set<string>();
	for (const session of sessions) {
		names.add(sanitizeTitle(session.title));
	}
	return [...names].join("\n");
}

export function formatFailedCronJson(
	sessions: SessionRow[],
	agents: AgentRecord[],
): string {
	const agentNames = createAgentNameMap(agents);
	return JSON.stringify(
		sessions.map((session) => ({
			agent: agentNames.get(session.agentId) ?? session.agentId,
			agentId: session.agentId,
			job: sanitizeTitle(session.title),
			providerId: session.providerId,
			sessionId: session.sdkSessionId,
			failedAt: session.failedAt,
			error: session.failureMessage ?? "",
		})),
		null,
		2,
	);
}

function formatFailureMessage(message: string | undefined): string {
	return (message ?? "").replaceAll(/\s+/g, " ").trim();
}
