import { create } from "zustand";

export interface BrowserTerminalEntry {
	agentId: string;
	createdAt: number;
	id: string;
	name: string;
}

interface TerminalCreationOptions {
	now?: number;
}

export interface BrowserTerminalState {
	activeTerminalIdByAgent: Record<string, string | null>;
	nextTerminalNumberByAgent: Record<string, number>;
	terminalsByAgent: Record<string, BrowserTerminalEntry[]>;

	closeTerminal: (agentId: string, terminalId: string) => void;
	createTerminal: (
		agentId: string,
		options?: TerminalCreationOptions,
	) => string;
	ensureTerminal: (
		agentId: string,
		options?: TerminalCreationOptions,
	) => string;
	renameTerminal: (agentId: string, terminalId: string, name: string) => void;
	setActiveTerminal: (agentId: string, terminalId: string) => void;
}

function createTerminalEntry(
	agentId: string,
	terminalNumber: number,
	now: number,
): BrowserTerminalEntry {
	return {
		agentId,
		createdAt: now,
		id: `${agentId}-terminal-${terminalNumber}-${crypto.randomUUID()}`,
		name: terminalNumber === 1 ? "Terminal" : `Terminal ${terminalNumber}`,
	};
}

function resolveNextActiveTerminal(
	terminals: BrowserTerminalEntry[],
	closedTerminalId: string,
): string | null {
	if (terminals.length === 0) {
		return null;
	}

	const closedIndex = terminals.findIndex(
		(terminal) => terminal.id === closedTerminalId,
	);
	if (closedIndex <= 0) {
		return terminals[0]?.id ?? null;
	}

	return terminals[closedIndex - 1]?.id ?? terminals[0]?.id ?? null;
}

export function createTerminalStore() {
	return create<BrowserTerminalState>((set, get) => ({
		activeTerminalIdByAgent: {},
		nextTerminalNumberByAgent: {},
		terminalsByAgent: {},

		closeTerminal: (agentId, terminalId) =>
			set((state) => {
				const terminals = state.terminalsByAgent[agentId] ?? [];
				const nextTerminals = terminals.filter(
					(terminal) => terminal.id !== terminalId,
				);
				const activeTerminalId = state.activeTerminalIdByAgent[agentId];

				return {
					activeTerminalIdByAgent: {
						...state.activeTerminalIdByAgent,
						[agentId]:
							activeTerminalId === terminalId
								? resolveNextActiveTerminal(terminals, terminalId)
								: (activeTerminalId ?? nextTerminals[0]?.id ?? null),
					},
					terminalsByAgent: {
						...state.terminalsByAgent,
						[agentId]: nextTerminals,
					},
				};
			}),

		createTerminal: (agentId, options) => {
			const now = options?.now ?? Date.now();
			const state = get();
			const nextTerminalNumber =
				(state.nextTerminalNumberByAgent[agentId] ?? 0) + 1;
			const terminal = createTerminalEntry(agentId, nextTerminalNumber, now);

			set((currentState) => ({
				activeTerminalIdByAgent: {
					...currentState.activeTerminalIdByAgent,
					[agentId]: terminal.id,
				},
				nextTerminalNumberByAgent: {
					...currentState.nextTerminalNumberByAgent,
					[agentId]: nextTerminalNumber,
				},
				terminalsByAgent: {
					...currentState.terminalsByAgent,
					[agentId]: [
						...(currentState.terminalsByAgent[agentId] ?? []),
						terminal,
					],
				},
			}));

			return terminal.id;
		},

		ensureTerminal: (agentId, options) => {
			const existingTerminalId = get().terminalsByAgent[agentId]?.[0]?.id;
			if (existingTerminalId) {
				if ((get().activeTerminalIdByAgent[agentId] ?? null) === null) {
					set((state) => ({
						activeTerminalIdByAgent: {
							...state.activeTerminalIdByAgent,
							[agentId]: existingTerminalId,
						},
					}));
				}
				return existingTerminalId;
			}

			return get().createTerminal(agentId, options);
		},

		renameTerminal: (agentId, terminalId, name) =>
			set((state) => {
				const nextName = name.trim();
				if (nextName.length === 0) {
					return state;
				}

				const terminals = state.terminalsByAgent[agentId] ?? [];
				if (!terminals.some((terminal) => terminal.id === terminalId)) {
					return state;
				}

				return {
					terminalsByAgent: {
						...state.terminalsByAgent,
						[agentId]: terminals.map((terminal) =>
							terminal.id === terminalId
								? { ...terminal, name: nextName }
								: terminal,
						),
					},
				};
			}),

		setActiveTerminal: (agentId, terminalId) =>
			set((state) => {
				const terminals = state.terminalsByAgent[agentId] ?? [];
				if (!terminals.some((terminal) => terminal.id === terminalId)) {
					return state;
				}

				return {
					activeTerminalIdByAgent: {
						...state.activeTerminalIdByAgent,
						[agentId]: terminalId,
					},
				};
			}),
	}));
}

export const useTerminalStore = createTerminalStore();

const EMPTY_TERMINALS: BrowserTerminalEntry[] = [];

export function selectAgentTerminals(
	state: BrowserTerminalState,
	agentId: string | null,
) {
	return agentId
		? (state.terminalsByAgent[agentId] ?? EMPTY_TERMINALS)
		: EMPTY_TERMINALS;
}

export function selectActiveTerminalId(
	state: BrowserTerminalState,
	agentId: string | null,
) {
	return agentId ? (state.activeTerminalIdByAgent[agentId] ?? null) : null;
}
