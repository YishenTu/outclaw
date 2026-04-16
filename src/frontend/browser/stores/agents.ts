import { create } from "zustand";

const AGENT_ORDER_STORAGE_KEY = "outclaw.browser.agent_order";

export interface AgentEntry {
	agentId: string;
	name: string;
}

export type AgentReorderPosition = "before" | "after";

export interface AgentsState {
	agents: AgentEntry[];
	activeAgentId: string | null;
	agentOrder: string[];

	setAgents: (agents: AgentEntry[]) => void;
	setActiveAgent: (agentId: string | null) => void;
	reorderAgents: (
		sourceAgentId: string,
		targetAgentId: string,
		position: AgentReorderPosition,
	) => void;
}

function readStoredAgentOrder(): string[] {
	if (typeof localStorage === "undefined") {
		return [];
	}

	try {
		const raw = localStorage.getItem(AGENT_ORDER_STORAGE_KEY);
		if (!raw) {
			return [];
		}

		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((value): value is string => typeof value === "string")
			: [];
	} catch {
		return [];
	}
}

function writeStoredAgentOrder(agentOrder: string[]) {
	if (typeof localStorage === "undefined") {
		return;
	}

	try {
		localStorage.setItem(AGENT_ORDER_STORAGE_KEY, JSON.stringify(agentOrder));
	} catch {
		// Ignore unavailable storage.
	}
}

function applyAgentOrder(
	agents: AgentEntry[],
	agentOrder: string[],
): AgentEntry[] {
	const remainingAgents = new Map(
		agents.map((agent) => [agent.agentId, agent] as const),
	);
	const orderedAgents: AgentEntry[] = [];

	for (const agentId of agentOrder) {
		const agent = remainingAgents.get(agentId);
		if (!agent) {
			continue;
		}
		orderedAgents.push(agent);
		remainingAgents.delete(agentId);
	}

	return [...orderedAgents, ...remainingAgents.values()];
}

export const useAgentsStore = create<AgentsState>((set) => ({
	agents: [],
	activeAgentId: null,
	agentOrder: readStoredAgentOrder(),
	setAgents: (agents) =>
		set((state) => {
			const orderedAgents = applyAgentOrder(agents, state.agentOrder);
			const agentOrder = orderedAgents.map((agent) => agent.agentId);
			writeStoredAgentOrder(agentOrder);
			return {
				agents: orderedAgents,
				agentOrder,
			};
		}),
	setActiveAgent: (activeAgentId) => set({ activeAgentId }),
	reorderAgents: (sourceAgentId, targetAgentId, position) =>
		set((state) => {
			if (sourceAgentId === targetAgentId) {
				return state;
			}

			const nextAgents = [...state.agents];
			const sourceIndex = nextAgents.findIndex(
				(agent) => agent.agentId === sourceAgentId,
			);
			const targetIndex = nextAgents.findIndex(
				(agent) => agent.agentId === targetAgentId,
			);
			if (sourceIndex === -1 || targetIndex === -1) {
				return state;
			}

			const [sourceAgent] = nextAgents.splice(sourceIndex, 1);
			if (!sourceAgent) {
				return state;
			}

			const insertionIndex =
				(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex) +
				(position === "after" ? 1 : 0);
			nextAgents.splice(insertionIndex, 0, sourceAgent);
			const agentOrder = nextAgents.map((agent) => agent.agentId);
			writeStoredAgentOrder(agentOrder);
			return {
				agents: nextAgents,
				agentOrder,
			};
		}),
}));
