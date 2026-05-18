import { create } from "zustand";
import type { BrowserCronEntry } from "../../../common/protocol.ts";

export interface CronPanelAgentCache {
	entries: BrowserCronEntry[];
	error: string | null;
	loadedRevision: number | null;
	loading: boolean;
}

interface CronPanelCacheState {
	cacheByAgent: Record<string, CronPanelAgentCache>;
	acceptEntries: (
		agentId: string,
		cronRevision: number,
		entries: BrowserCronEntry[],
	) => void;
	beginLoad: (agentId: string) => void;
	rejectEntries: (
		agentId: string,
		cronRevision: number,
		errorMessage: string,
		fallbackEntries: BrowserCronEntry[],
	) => void;
	updateEntry: (agentId: string, entry: BrowserCronEntry) => void;
}

const EMPTY_CRON_PANEL_AGENT_CACHE: CronPanelAgentCache = {
	entries: [],
	error: null,
	loadedRevision: null,
	loading: false,
};

export function shouldLoadCronEntries({
	cronRevision,
	loadedRevision,
}: {
	cronRevision: number;
	loadedRevision: number | null;
}): boolean {
	return loadedRevision !== cronRevision;
}

export function shouldShowCronLoading({
	entries,
	loading,
}: Pick<CronPanelAgentCache, "entries" | "loading">): boolean {
	return loading && entries.length === 0;
}

export function getCronPanelAgentCache(
	state: CronPanelCacheState,
	agentId: string,
): CronPanelAgentCache {
	return state.cacheByAgent[agentId] ?? EMPTY_CRON_PANEL_AGENT_CACHE;
}

export function createCronPanelCacheStore() {
	return create<CronPanelCacheState>((set) => ({
		cacheByAgent: {},
		acceptEntries: (agentId, cronRevision, entries) =>
			set((state) => {
				const current = getCronPanelAgentCache(state, agentId);
				const next: CronPanelAgentCache = {
					entries,
					error: null,
					loadedRevision: cronRevision,
					loading: false,
				};
				if (cronPanelAgentCachesEqual(current, next)) {
					return state;
				}
				return setAgentCache(state, agentId, next);
			}),
		beginLoad: (agentId) =>
			set((state) => {
				const current = getCronPanelAgentCache(state, agentId);
				const next: CronPanelAgentCache = {
					...current,
					error: current.entries.length > 0 ? null : current.error,
					loading: true,
				};
				if (cronPanelAgentCachesEqual(current, next)) {
					return state;
				}
				return setAgentCache(state, agentId, next);
			}),
		rejectEntries: (agentId, _cronRevision, errorMessage, fallbackEntries) =>
			set((state) => {
				const current = getCronPanelAgentCache(state, agentId);
				const hasVisibleEntries = current.entries.length > 0;
				const next: CronPanelAgentCache = {
					entries: hasVisibleEntries ? current.entries : fallbackEntries,
					error: hasVisibleEntries ? null : errorMessage,
					loadedRevision: current.loadedRevision,
					loading: false,
				};
				if (cronPanelAgentCachesEqual(current, next)) {
					return state;
				}
				return setAgentCache(state, agentId, next);
			}),
		updateEntry: (agentId, entry) =>
			set((state) => {
				const current = getCronPanelAgentCache(state, agentId);
				const nextEntries = current.entries.map((currentEntry) =>
					currentEntry.path === entry.path
						? {
								...currentEntry,
								...entry,
								error: undefined,
							}
						: currentEntry,
				);
				if (cronEntriesEqual(current.entries, nextEntries)) {
					return state;
				}
				return setAgentCache(state, agentId, {
					...current,
					entries: nextEntries,
				});
			}),
	}));
}

export const useCronPanelCacheStore = createCronPanelCacheStore();

function setAgentCache(
	state: CronPanelCacheState,
	agentId: string,
	cache: CronPanelAgentCache,
): Pick<CronPanelCacheState, "cacheByAgent"> {
	return {
		cacheByAgent: {
			...state.cacheByAgent,
			[agentId]: cache,
		},
	};
}

function cronPanelAgentCachesEqual(
	left: CronPanelAgentCache,
	right: CronPanelAgentCache,
): boolean {
	return (
		left.error === right.error &&
		left.loadedRevision === right.loadedRevision &&
		left.loading === right.loading &&
		cronEntriesEqual(left.entries, right.entries)
	);
}

function cronEntriesEqual(
	left: BrowserCronEntry[],
	right: BrowserCronEntry[],
): boolean {
	return (
		left.length === right.length &&
		left.every((entry, index) => {
			const other = right[index];
			return other !== undefined && cronEntryEqual(entry, other);
		})
	);
}

function cronEntryEqual(
	left: BrowserCronEntry,
	right: BrowserCronEntry,
): boolean {
	return (
		left.name === right.name &&
		left.path === right.path &&
		left.schedule === right.schedule &&
		left.scheduleKind === right.scheduleKind &&
		left.runAt === right.runAt &&
		left.timezone === right.timezone &&
		left.model === right.model &&
		left.effort === right.effort &&
		left.enabled === right.enabled &&
		left.status === right.status &&
		left.error === right.error
	);
}
