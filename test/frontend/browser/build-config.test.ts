import { describe, expect, test } from "bun:test";
import {
	BROWSER_CHUNK_WARNING_LIMIT_KIB,
	browserBuildConfig,
} from "../../../src/frontend/browser/build/build-config.ts";
import { manualChunkForBrowserModule } from "../../../src/frontend/browser/build/manual-chunks.ts";

describe("browser build config", () => {
	test("uses an explicit chunk warning budget above Vite's default", () => {
		expect(BROWSER_CHUNK_WARNING_LIMIT_KIB).toBeGreaterThan(500);
		expect(browserBuildConfig.chunkSizeWarningLimit).toBe(
			BROWSER_CHUNK_WARNING_LIMIT_KIB,
		);
	});

	test("keeps manual chunk splitting enabled", () => {
		expect(browserBuildConfig.rollupOptions?.output?.manualChunks).toBe(
			manualChunkForBrowserModule,
		);
	});
});
