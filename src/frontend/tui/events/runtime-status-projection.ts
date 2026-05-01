import type { ServerEvent } from "../../../common/protocol.ts";
import type { RuntimeInfo } from "../chrome/status-bar.tsx";

type RuntimeStatusEvent = Extract<ServerEvent, { type: "runtime_status" }>;
type RuntimeInfoEvent = Extract<
	ServerEvent,
	{ type: "agent_switched" | "effort_changed" | "model_changed" }
>;

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
			notice:
				params.event.notice?.kind === "rollover"
					? params.event.notice.message
					: params.event.notice?.kind === "restart_required"
						? "Restart required"
						: undefined,
			contextTokens: params.event.usage?.contextTokens,
			contextWindow: params.event.usage?.contextWindow,
			nextHeartbeatAt: params.event.nextHeartbeatAt,
			heartbeatDeferred: params.event.heartbeatDeferred,
		},
	};
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
