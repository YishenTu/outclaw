import { describe, expect, test } from "bun:test";
import {
	formatMaybeProviderSessionRef,
	formatProviderSessionRef,
	providerSessionRefKey,
	providerSessionRefsEqual,
} from "../../src/common/provider-session-ref.ts";

describe("provider session refs", () => {
	test("builds an opaque stable key from provider and sdk session ids", () => {
		expect(
			providerSessionRefKey({
				providerId: "codex",
				sdkSessionId: "thread-1",
			}),
		).toBe("codex\u0000thread-1");
	});

	test("formats provider session refs for user-facing messages", () => {
		expect(
			formatProviderSessionRef({
				providerId: "codex",
				sdkSessionId: "thread-1",
			}),
		).toBe("codex/thread-1");
		expect(formatMaybeProviderSessionRef({ sdkSessionId: "thread-1" })).toBe(
			"thread-1",
		);
	});

	test("compares refs by provider and sdk session ids", () => {
		expect(
			providerSessionRefsEqual(
				{ providerId: "codex", sdkSessionId: "thread-1" },
				{ providerId: "codex", sdkSessionId: "thread-1" },
			),
		).toBe(true);
		expect(
			providerSessionRefsEqual(
				{ providerId: "claude", sdkSessionId: "thread-1" },
				{ providerId: "codex", sdkSessionId: "thread-1" },
			),
		).toBe(false);
	});
});
