import { describe, expect, test } from "bun:test";
import { BROWSER_CONFIG_SCHEMA } from "../../../src/runtime/browser/config-schema.ts";
import { createBrowserConfigSchema } from "../../../src/runtime/config/browser-schema.ts";

describe("browser config schema", () => {
	test("is projected from the runtime config policy", () => {
		expect(BROWSER_CONFIG_SCHEMA).toEqual(createBrowserConfigSchema());
	});
});
