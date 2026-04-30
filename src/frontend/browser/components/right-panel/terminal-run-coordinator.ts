import type { TerminalRunRequest } from "./terminal-view.tsx";

export type TerminalRunRequestsByAgent = Record<string, TerminalRunRequest>;

export function createTerminalRunRequest(params: {
	command: string;
	nextRequestId: number;
}): {
	nextRequestId: number;
	request: TerminalRunRequest;
} {
	const nextRequestId = params.nextRequestId + 1;
	return {
		nextRequestId,
		request: {
			command: params.command,
			id: nextRequestId,
		},
	};
}

export function storeTerminalRunRequest(
	current: TerminalRunRequestsByAgent,
	agentId: string,
	request: TerminalRunRequest,
): TerminalRunRequestsByAgent {
	return {
		...current,
		[agentId]: request,
	};
}

export function clearDispatchedTerminalRunRequest(
	current: TerminalRunRequestsByAgent,
	agentId: string,
	requestId: number,
): TerminalRunRequestsByAgent {
	if (current[agentId]?.id !== requestId) {
		return current;
	}

	const { [agentId]: _dispatched, ...nextRequests } = current;
	return nextRequests;
}
