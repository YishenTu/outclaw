import { create } from "zustand";
import type { BrowserTerminalSummary } from "../../../common/protocol.ts";

export interface BrowserTerminalEntry {
	agentId: string;
	createdAt: number;
	id: string;
	name: string;
	runtimeState: "pending" | "ready";
}

export type BrowserTerminalTab = "run" | "terminal";

interface TerminalCreationOptions {
	now?: number;
}

export interface BrowserTerminalState {
	activeTerminalIdByAgent: Record<string, string | null>;
	activeTerminalTabByAgent: Record<string, BrowserTerminalTab>;
	nextTerminalNumberByAgent: Record<string, number>;
	runtimeTerminalsHydrated: boolean;
	runTerminalCommandByAgent: Record<string, string | null>;
	terminalsByAgent: Record<string, BrowserTerminalEntry[]>;

	applyRuntimeTerminals: (terminals: BrowserTerminalSummary[]) => void;
	closeTerminal: (agentId: string, terminalId: string) => void;
	createTerminal: (
		agentId: string,
		options?: TerminalCreationOptions,
	) => string;
	executeRunTerminal: (agentId: string, command: string) => void;
	ensureTerminal: (
		agentId: string,
		options?: TerminalCreationOptions,
	) => string;
	markRuntimeTerminalClosed: (terminalId: string) => void;
	markRuntimeTerminalCreated: (terminal: BrowserTerminalSummary) => void;
	renameTerminal: (agentId: string, terminalId: string, name: string) => void;
	setActiveRunTerminal: (agentId: string) => void;
	setActiveTerminal: (agentId: string, terminalId: string) => void;
}

function createTerminalIdSuffix(now: number): string {
	const browserCrypto = globalThis.crypto;
	if (typeof browserCrypto?.randomUUID === "function") {
		return browserCrypto.randomUUID();
	}

	if (typeof browserCrypto?.getRandomValues === "function") {
		const bytes = new Uint8Array(16);
		browserCrypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
			"",
		);
	}

	return `fallback-${now.toString(36)}`;
}

function createTerminalEntry(
	agentId: string,
	terminalNumber: number,
	now: number,
	name: string,
): BrowserTerminalEntry {
	return {
		agentId,
		createdAt: now,
		id: `${agentId}-terminal-${terminalNumber}-${createTerminalIdSuffix(now)}`,
		name,
		runtimeState: "pending",
	};
}

function createDefaultTerminalName(displayNumber: number): string {
	return displayNumber === 1 ? "Terminal" : `Terminal ${displayNumber}`;
}

function isDefaultTerminalName(name: string): boolean {
	return /^Terminal(?: [1-9]\d*)?$/.test(name);
}

function resolveNextDefaultTerminalName(
	terminals: BrowserTerminalEntry[],
): string {
	const existingNames = new Set(terminals.map((terminal) => terminal.name));
	let displayNumber = 1;
	while (existingNames.has(createDefaultTerminalName(displayNumber))) {
		displayNumber += 1;
	}

	return createDefaultTerminalName(displayNumber);
}

function normalizeSingletonDefaultTerminalName(
	terminals: BrowserTerminalEntry[],
): BrowserTerminalEntry[] {
	const terminal = terminals[0];
	if (
		terminals.length !== 1 ||
		!terminal ||
		terminal.name === "Terminal" ||
		!isDefaultTerminalName(terminal.name)
	) {
		return terminals;
	}

	return [{ ...terminal, name: "Terminal" }];
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
		activeTerminalTabByAgent: {},
		nextTerminalNumberByAgent: {},
		runtimeTerminalsHydrated: false,
		runTerminalCommandByAgent: {},
		terminalsByAgent: {},

		applyRuntimeTerminals: (terminals) =>
			set((state) => {
				const runtimeEntries = groupRuntimeTerminals(terminals);
				const scopeIds = new Set([
					...Object.keys(state.terminalsByAgent),
					...Object.keys(runtimeEntries),
				]);
				const nextTerminalsByAgent = { ...state.terminalsByAgent };
				const nextActiveTerminalIdByAgent = {
					...state.activeTerminalIdByAgent,
				};
				const nextActiveTerminalTabByAgent = {
					...state.activeTerminalTabByAgent,
				};

				for (const scopeId of scopeIds) {
					const pending = (state.terminalsByAgent[scopeId] ?? []).filter(
						(terminal) => terminal.runtimeState === "pending",
					);
					const nextTerminals = [
						...(runtimeEntries[scopeId] ?? []),
						...pending.filter(
							(pendingTerminal) =>
								!(runtimeEntries[scopeId] ?? []).some(
									(runtimeTerminal) =>
										runtimeTerminal.id === pendingTerminal.id,
								),
						),
					];
					if (nextTerminals.length === 0) {
						delete nextTerminalsByAgent[scopeId];
						nextActiveTerminalIdByAgent[scopeId] = null;
						continue;
					}
					nextTerminalsByAgent[scopeId] = nextTerminals;
					const activeTerminalId = state.activeTerminalIdByAgent[scopeId];
					if (
						!activeTerminalId ||
						!nextTerminals.some((terminal) => terminal.id === activeTerminalId)
					) {
						nextActiveTerminalIdByAgent[scopeId] = nextTerminals[0]?.id ?? null;
					}
					nextActiveTerminalTabByAgent[scopeId] =
						state.activeTerminalTabByAgent[scopeId] ?? "terminal";
				}

				return {
					activeTerminalIdByAgent: nextActiveTerminalIdByAgent,
					activeTerminalTabByAgent: nextActiveTerminalTabByAgent,
					runtimeTerminalsHydrated: true,
					terminalsByAgent: nextTerminalsByAgent,
				};
			}),

		closeTerminal: (agentId, terminalId) =>
			set((state) => {
				const terminals = state.terminalsByAgent[agentId] ?? [];
				if (!terminals.some((terminal) => terminal.id === terminalId)) {
					return state;
				}

				const nextTerminals = terminals.filter(
					(terminal) => terminal.id !== terminalId,
				);
				const activeTerminalId = state.activeTerminalIdByAgent[agentId];
				if (nextTerminals.length === 0) {
					const now = Date.now();
					const nextTerminalNumber =
						(state.nextTerminalNumberByAgent[agentId] ?? 0) + 1;
					const replacement = createTerminalEntry(
						agentId,
						nextTerminalNumber,
						now,
						"Terminal",
					);

					return {
						activeTerminalIdByAgent: {
							...state.activeTerminalIdByAgent,
							[agentId]: replacement.id,
						},
						activeTerminalTabByAgent: {
							...state.activeTerminalTabByAgent,
							[agentId]:
								state.activeTerminalTabByAgent[agentId] === "run"
									? "run"
									: "terminal",
						},
						nextTerminalNumberByAgent: {
							...state.nextTerminalNumberByAgent,
							[agentId]: nextTerminalNumber,
						},
						terminalsByAgent: {
							...state.terminalsByAgent,
							[agentId]: [replacement],
						},
					};
				}

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
						[agentId]: normalizeSingletonDefaultTerminalName(nextTerminals),
					},
				};
			}),

		createTerminal: (agentId, options) => {
			const now = options?.now ?? Date.now();
			const state = get();
			const nextTerminalNumber =
				(state.nextTerminalNumberByAgent[agentId] ?? 0) + 1;
			const terminal = createTerminalEntry(
				agentId,
				nextTerminalNumber,
				now,
				resolveNextDefaultTerminalName(state.terminalsByAgent[agentId] ?? []),
			);

			set((currentState) => ({
				activeTerminalIdByAgent: {
					...currentState.activeTerminalIdByAgent,
					[agentId]: terminal.id,
				},
				activeTerminalTabByAgent: {
					...currentState.activeTerminalTabByAgent,
					[agentId]: "terminal",
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
			if (!get().runtimeTerminalsHydrated) {
				return "";
			}
			const existingTerminalId = get().terminalsByAgent[agentId]?.[0]?.id;
			if (existingTerminalId) {
				if (
					(get().activeTerminalIdByAgent[agentId] ?? null) === null ||
					get().activeTerminalTabByAgent[agentId] === undefined
				) {
					set((state) => ({
						activeTerminalIdByAgent: {
							...state.activeTerminalIdByAgent,
							[agentId]: existingTerminalId,
						},
						activeTerminalTabByAgent: {
							...state.activeTerminalTabByAgent,
							[agentId]: state.activeTerminalTabByAgent[agentId] ?? "terminal",
						},
					}));
				}
				return existingTerminalId;
			}

			return get().createTerminal(agentId, options);
		},

		markRuntimeTerminalClosed: (terminalId) =>
			set((state) => {
				for (const [agentId, terminals] of Object.entries(
					state.terminalsByAgent,
				)) {
					if (!terminals.some((terminal) => terminal.id === terminalId)) {
						continue;
					}
					const nextTerminals = terminals.filter(
						(terminal) => terminal.id !== terminalId,
					);
					return {
						activeTerminalIdByAgent: {
							...state.activeTerminalIdByAgent,
							[agentId]:
								state.activeTerminalIdByAgent[agentId] === terminalId
									? (nextTerminals[0]?.id ?? null)
									: (state.activeTerminalIdByAgent[agentId] ?? null),
						},
						terminalsByAgent: {
							...state.terminalsByAgent,
							[agentId]: nextTerminals,
						},
					};
				}
				return state;
			}),

		markRuntimeTerminalCreated: (terminal) =>
			set((state) => {
				if (isRunTerminalSummary(terminal)) {
					return state;
				}
				const runtimeEntry = runtimeSummaryToTerminalEntry(terminal);
				const terminals = state.terminalsByAgent[terminal.scopeId] ?? [];
				const existing = terminals.some((entry) => entry.id === terminal.id);
				const nextTerminals = existing
					? terminals.map((entry) =>
							entry.id === terminal.id ? runtimeEntry : entry,
						)
					: [...terminals, runtimeEntry];

				return {
					activeTerminalIdByAgent: {
						...state.activeTerminalIdByAgent,
						[terminal.scopeId]:
							state.activeTerminalIdByAgent[terminal.scopeId] ?? terminal.id,
					},
					activeTerminalTabByAgent: {
						...state.activeTerminalTabByAgent,
						[terminal.scopeId]:
							state.activeTerminalTabByAgent[terminal.scopeId] ?? "terminal",
					},
					terminalsByAgent: {
						...state.terminalsByAgent,
						[terminal.scopeId]: nextTerminals,
					},
				};
			}),

		executeRunTerminal: (agentId, command) =>
			set((state) => ({
				activeTerminalTabByAgent: {
					...state.activeTerminalTabByAgent,
					[agentId]: "run",
				},
				runTerminalCommandByAgent: {
					...state.runTerminalCommandByAgent,
					[agentId]: command,
				},
			})),

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

		setActiveRunTerminal: (agentId) =>
			set((state) => ({
				activeTerminalTabByAgent: {
					...state.activeTerminalTabByAgent,
					[agentId]: "run",
				},
			})),

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
					activeTerminalTabByAgent: {
						...state.activeTerminalTabByAgent,
						[agentId]: "terminal",
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

export function selectActiveTerminalTab(
	state: BrowserTerminalState,
	agentId: string | null,
): BrowserTerminalTab {
	return agentId
		? (state.activeTerminalTabByAgent[agentId] ?? "terminal")
		: "terminal";
}

export function selectRunTerminalCommand(
	state: BrowserTerminalState,
	agentId: string | null,
) {
	return agentId ? (state.runTerminalCommandByAgent[agentId] ?? null) : null;
}

function groupRuntimeTerminals(
	terminals: BrowserTerminalSummary[],
): Record<string, BrowserTerminalEntry[]> {
	const grouped: Record<string, BrowserTerminalEntry[]> = {};
	for (const terminal of terminals) {
		if (isRunTerminalSummary(terminal)) {
			continue;
		}
		const entries = grouped[terminal.scopeId] ?? [];
		entries.push(runtimeSummaryToTerminalEntry(terminal));
		grouped[terminal.scopeId] = entries;
	}
	return grouped;
}

function runtimeSummaryToTerminalEntry(
	terminal: BrowserTerminalSummary,
): BrowserTerminalEntry {
	return {
		agentId: terminal.scopeId,
		createdAt: terminal.createdAt,
		id: terminal.id,
		name: terminal.name,
		runtimeState: "ready",
	};
}

function isRunTerminalSummary(terminal: BrowserTerminalSummary): boolean {
	return terminal.id === `${terminal.scopeId}:run`;
}
