import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/runtime/config.ts";

function tmp() {
	return mkdtempSync(join(tmpdir(), "mis-config-"));
}

describe("loadConfig", () => {
	test("returns defaults when no config file exists", () => {
		const dir = tmp();
		try {
			const config = loadConfig(dir);
			expect(config.port).toBe(4000);
			expect(config.telegram.botToken).toBe("");
			expect(config.telegram.allowedUsers).toEqual([]);
			expect(config.permissionMode).toBe("bypassPermissions");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("reads values from config.json", () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({
					port: 5000,
					telegram: {
						botToken: "abc:123",
						allowedUsers: [111, 222],
					},
					permissionMode: "default",
				}),
			);

			const config = loadConfig(dir);
			expect(config.port).toBe(5000);
			expect(config.telegram.botToken).toBe("abc:123");
			expect(config.telegram.allowedUsers).toEqual([111, 222]);
			expect(config.permissionMode).toBe("default");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("merges partial config with defaults", () => {
		const dir = tmp();
		try {
			writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 3000 }));

			const config = loadConfig(dir);
			expect(config.port).toBe(3000);
			expect(config.telegram.botToken).toBe("");
			expect(config.telegram.allowedUsers).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("merges partial telegram config with defaults", () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ telegram: { botToken: "tok" } }),
			);

			const config = loadConfig(dir);
			expect(config.telegram.botToken).toBe("tok");
			expect(config.telegram.allowedUsers).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("resolves $ENV_VAR references in string values", () => {
		const dir = tmp();
		const origToken = process.env.TEST_BOT_TOKEN;
		try {
			process.env.TEST_BOT_TOKEN = "resolved-token";
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ telegram: { botToken: "$TEST_BOT_TOKEN" } }),
			);

			const config = loadConfig(dir);
			expect(config.telegram.botToken).toBe("resolved-token");
		} finally {
			if (origToken === undefined) delete process.env.TEST_BOT_TOKEN;
			else process.env.TEST_BOT_TOKEN = origToken;
			rmSync(dir, { recursive: true });
		}
	});

	test("resolves $ENV_VAR for allowedUsers as comma-separated numbers", () => {
		const dir = tmp();
		const orig = process.env.TEST_ALLOWED;
		try {
			process.env.TEST_ALLOWED = "111,222,333";
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ telegram: { allowedUsers: "$TEST_ALLOWED" } }),
			);

			const config = loadConfig(dir);
			expect(config.telegram.allowedUsers).toEqual([111, 222, 333]);
		} finally {
			if (orig === undefined) delete process.env.TEST_ALLOWED;
			else process.env.TEST_ALLOWED = orig;
			rmSync(dir, { recursive: true });
		}
	});

	test("returns empty array when allowedUsers env var is not set", () => {
		const dir = tmp();
		try {
			delete process.env.NONEXISTENT_USERS_VAR;
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({
					telegram: { allowedUsers: "$NONEXISTENT_USERS_VAR" },
				}),
			);

			const config = loadConfig(dir);
			expect(config.telegram.allowedUsers).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("loads .env file from homeDir", () => {
		const dir = tmp();
		const origKey = process.env.MIS_TEST_ENV_LOAD;
		try {
			delete process.env.MIS_TEST_ENV_LOAD;
			writeFileSync(join(dir, ".env"), "MIS_TEST_ENV_LOAD=from-env-file");
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ telegram: { botToken: "$MIS_TEST_ENV_LOAD" } }),
			);

			const config = loadConfig(dir);
			expect(config.telegram.botToken).toBe("from-env-file");
		} finally {
			if (origKey === undefined) delete process.env.MIS_TEST_ENV_LOAD;
			else process.env.MIS_TEST_ENV_LOAD = origKey;
			rmSync(dir, { recursive: true });
		}
	});

	test(".env does not overwrite existing env vars", () => {
		const dir = tmp();
		const origKey = process.env.MIS_TEST_NO_CLOBBER;
		try {
			process.env.MIS_TEST_NO_CLOBBER = "already-set";
			writeFileSync(join(dir, ".env"), "MIS_TEST_NO_CLOBBER=from-file");
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ telegram: { botToken: "$MIS_TEST_NO_CLOBBER" } }),
			);

			const config = loadConfig(dir);
			expect(config.telegram.botToken).toBe("already-set");
		} finally {
			if (origKey === undefined) delete process.env.MIS_TEST_NO_CLOBBER;
			else process.env.MIS_TEST_NO_CLOBBER = origKey;
			rmSync(dir, { recursive: true });
		}
	});

	test("leaves $ENV_VAR as empty string when env var is not set", () => {
		const dir = tmp();
		try {
			delete process.env.NONEXISTENT_VAR_FOR_TEST;
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ telegram: { botToken: "$NONEXISTENT_VAR_FOR_TEST" } }),
			);

			const config = loadConfig(dir);
			expect(config.telegram.botToken).toBe("");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
