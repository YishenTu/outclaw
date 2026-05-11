import { describe, expect, test } from "bun:test";
import { createFacadeForProvider } from "../../src/backend/facade-registry.ts";

describe("createFacadeForProvider", () => {
	test("creates the Codex backend facade", () => {
		const facade = createFacadeForProvider("codex");

		expect(facade?.providerId).toBe("codex");
		expect(facade?.run).toBeFunction();
	});
});
