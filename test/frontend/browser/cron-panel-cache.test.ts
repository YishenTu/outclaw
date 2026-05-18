import { describe, expect, test } from "bun:test";
import type { BrowserCronEntry } from "../../../src/common/protocol.ts";
import {
	createCronPanelCacheStore,
	getCronPanelAgentCache,
	shouldLoadCronEntries,
	shouldShowCronLoading,
} from "../../../src/frontend/browser/stores/cron-panel-cache.ts";

const CRON_ENTRY: BrowserCronEntry = {
	enabled: true,
	name: "daily",
	path: "cron/daily.yaml",
	schedule: "15 6 * * *",
	scheduleKind: "recurring",
	status: "scheduled",
};

describe("cron panel cache store", () => {
	test("shows loading before an uncached agent revision has rendered", () => {
		const store = createCronPanelCacheStore();
		const cache = getCronPanelAgentCache(store.getState(), "agent-alpha");
		const loading = shouldLoadCronEntries({
			cronRevision: 0,
			loadedRevision: cache.loadedRevision,
		});

		expect(shouldShowCronLoading({ entries: cache.entries, loading })).toBe(
			true,
		);
	});

	test("does not reload a cached agent cron list for the same revision", () => {
		const store = createCronPanelCacheStore();

		store.getState().acceptEntries("agent-alpha", 2, [CRON_ENTRY]);

		expect(
			shouldLoadCronEntries({
				cronRevision: 2,
				loadedRevision: getCronPanelAgentCache(store.getState(), "agent-alpha")
					.loadedRevision,
			}),
		).toBe(false);
		expect(
			shouldShowCronLoading(
				getCronPanelAgentCache(store.getState(), "agent-alpha"),
			),
		).toBe(false);
	});

	test("keeps visible cron entries while a stale revision refreshes", () => {
		const store = createCronPanelCacheStore();
		store.getState().acceptEntries("agent-alpha", 1, [CRON_ENTRY]);

		store.getState().beginLoad("agent-alpha");

		const cache = getCronPanelAgentCache(store.getState(), "agent-alpha");
		expect(cache.entries).toEqual([CRON_ENTRY]);
		expect(cache.loading).toBe(true);
		expect(shouldShowCronLoading(cache)).toBe(false);
		expect(
			shouldLoadCronEntries({
				cronRevision: 2,
				loadedRevision: cache.loadedRevision,
			}),
		).toBe(true);
	});

	test("keeps cached rows when a background cron refresh fails", () => {
		const store = createCronPanelCacheStore();
		store.getState().acceptEntries("agent-alpha", 1, [CRON_ENTRY]);

		store
			.getState()
			.rejectEntries("agent-alpha", 2, "Failed to load cron jobs", []);

		const cache = getCronPanelAgentCache(store.getState(), "agent-alpha");
		expect(cache.entries).toEqual([CRON_ENTRY]);
		expect(cache.error).toBeNull();
		expect(cache.loadedRevision).toBe(1);
	});
});
