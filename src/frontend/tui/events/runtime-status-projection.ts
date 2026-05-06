import type { ServerEvent } from "../../../common/protocol.ts";
import type { RuntimeInfo } from "../chrome/status-bar.tsx";

type RuntimeStatusEvent = Extract<ServerEvent, { type: "runtime_status" }>;
type RuntimeInfoEvent = Extract<
	ServerEvent,
	{ type: "agent_switched" | "effort_changed" | "model_changed" }
>;

const TUI_ROLLOVER_NOTICE = "Rollover done; next prompt starts a new session.";
const TUI_ROLLOVER_FAILED_NOTICE =
	"Rollover final check failed; next prompt starts a new session.";

export function projectRuntimeStatus(params: {
	event: RuntimeStatusEvent;
	knownAgentName?: string;
	previous: RuntimeInfo;
}): { agentName?: string; runtimeInfo: RuntimeInfo; running: boolean } {
	const agentName =
		params.event.agentName ??
		params.knownAgentName ??
		params.previous.agentName;
	return {
		agentName,
		running: params.event.running,
		runtimeInfo: {
			agentName,
			model: params.event.model,
			effort: params.event.effort,
			notice: projectRuntimeNotice(params.event.notice),
			contextTokens: params.event.usage?.contextTokens,
			contextWindow: params.event.usage?.contextWindow,
			nextHeartbeatAt: params.event.nextHeartbeatAt,
			heartbeatDeferred: params.event.heartbeatDeferred,
		},
	};
}

function projectRuntimeNotice(
	notice: RuntimeStatusEvent["notice"],
): string | undefined {
	if (notice?.kind === "restart_required") {
		return "Restart required";
	}
	if (notice?.kind === "rollover") {
		return notice.finalCheck === "failed"
			? TUI_ROLLOVER_FAILED_NOTICE
			: TUI_ROLLOVER_NOTICE;
	}
	return undefined;
}

export function projectRuntimeInfoEvent(
	previous: RuntimeInfo,
	event: RuntimeInfoEvent,
): RuntimeInfo {
	if (event.type === "agent_switched") {
		return {
			...previous,
			agentName: event.name,
		};
	}
	if (event.type === "model_changed") {
		return {
			...previous,
			model: event.model,
		};
	}
	return {
		...previous,
		effort: event.effort,
	};
}
