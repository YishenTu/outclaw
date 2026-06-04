import { describe, expect, test } from "bun:test";
import { createFacadeForProvider } from "../../src/backend/facade-registry.ts";

describe("createFacadeForProvider", () => {
	test("creates backend facades for registered chat providers", () => {
		for (const providerId of ["claude", "codex", "pi"]) {
			const facade = createFacadeForProvider(providerId);

			expect(facade?.providerId).toBe(providerId);
			expect(facade?.run).toBeFunction();
		}
	});
});
