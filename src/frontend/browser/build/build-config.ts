import { manualChunkForBrowserModule } from "./manual-chunks.ts";

// Vite warns at 500 KiB by default, which is too low for this app's
// intentionally split vendor bundles.
export const BROWSER_CHUNK_WARNING_LIMIT_KIB = 1100;
export const BROWSER_ENTRY_CHUNK_BUDGET_KIB = 600;
export const BROWSER_INITIAL_SCRIPT_BUDGET_KIB = 2_700;

export const browserBuildConfig = {
	chunkSizeWarningLimit: BROWSER_CHUNK_WARNING_LIMIT_KIB,
	rollupOptions: {
		output: {
			manualChunks: manualChunkForBrowserModule,
		},
	},
};
