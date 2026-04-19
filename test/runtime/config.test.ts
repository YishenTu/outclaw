import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadGlobalConfig,
	updateGlobalConfig,
} from "../../src/runtime/config.ts";

function tmp() {
	return mkdtempSync(join(tmpdir(), "mis-config-"));
}

describe("loadGlobalConfig", () => {
	test("returns defaults and writes config.json when none exists", () => {
		const dir = tmp();
		try {
			const config = loadGlobalConfig(dir);
			expect(config.host).toBe("127.0.0.1");
			expect(config.port).toBe(4000);
			expect(config.heartbeat).toEqual({
				intervalMinutes: 30,
				deferMinutes: 0,
			});
			expect(existsSync(join(dir, "config.json"))).toBe(true);
			expect(
				JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")),
			).toEqual({
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: {
					intervalMinutes: 30,
					deferMinutes: 0,
				},
				port: 4000,
			});
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
					host: "0.0.0.0",
					port: 5000,
					heartbeat: {
						intervalMinutes: 15,
						deferMinutes: 3,
					},
				}),
			);

			const config = loadGlobalConfig(dir);
			expect(config.host).toBe("0.0.0.0");
			expect(config.port).toBe(5000);
			expect(config.heartbeat).toEqual({
				intervalMinutes: 15,
				deferMinutes: 3,
			});
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("merges partial config with defaults", () => {
		const dir = tmp();
		try {
			writeFileSync(join(dir, "config.json"), JSON.stringify({ port: 3000 }));

			const config = loadGlobalConfig(dir);
			expect(config.host).toBe("127.0.0.1");
			expect(config.port).toBe(3000);
			expect(config.heartbeat).toEqual({
				intervalMinutes: 30,
				deferMinutes: 0,
			});
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("preserves unknown config fields while only returning runtime-global values", () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({
					telegram: {
						botToken: "tok",
						allowedUsers: [123],
					},
				}),
			);

			const config = loadGlobalConfig(dir);
			expect(config.host).toBe("127.0.0.1");
			expect(config.port).toBe(4000);
			expect(config.heartbeat).toEqual({
				intervalMinutes: 30,
				deferMinutes: 0,
			});
			expect(
				JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")),
			).toEqual({
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: {
					intervalMinutes: 30,
					deferMinutes: 0,
				},
				port: 4000,
				telegram: {
					botToken: "tok",
					allowedUsers: [123],
				},
			});
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("merges partial heartbeat config with defaults", () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ heartbeat: { intervalMinutes: 5 } }),
			);

			const config = loadGlobalConfig(dir);
			expect(config.heartbeat).toEqual({
				intervalMinutes: 5,
				deferMinutes: 0,
			});
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test(".env does not overwrite existing env vars", () => {
		const dir = tmp();
		const origKey = process.env.MIS_TEST_NO_CLOBBER;
		try {
			process.env.MIS_TEST_NO_CLOBBER = "already-set";
			writeFileSync(join(dir, ".env"), "MIS_TEST_NO_CLOBBER=from-file");

			loadGlobalConfig(dir);
			expect(process.env.MIS_TEST_NO_CLOBBER).toBe("already-set");
		} finally {
			if (origKey === undefined) delete process.env.MIS_TEST_NO_CLOBBER;
			else process.env.MIS_TEST_NO_CLOBBER = origKey;
			rmSync(dir, { recursive: true });
		}
	});

	test("defaults autoCompact to true when not specified", () => {
		const dir = tmp();
		try {
			const config = loadGlobalConfig(dir);
			expect(config.autoCompact).toBe(true);
			expect(config.host).toBe("127.0.0.1");
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("reads autoCompact false from config", () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({ autoCompact: false }),
			);
			const config = loadGlobalConfig(dir);
			expect(config.autoCompact).toBe(false);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("materializes default rollover config for stored agents missing it", () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify({
					agents: {
						"agent-railly": {
							telegram: {
								botToken: "token-a",
								allowedUsers: [101],
							},
						},
					},
				}),
			);

			loadGlobalConfig(dir);

			expect(
				JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")),
			).toEqual({
				autoCompact: true,
				host: "127.0.0.1",
				heartbeat: {
					intervalMinutes: 30,
					deferMinutes: 0,
				},
				port: 4000,
				agents: {
					"agent-railly": {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							botToken: "token-a",
							allowedUsers: [101],
						},
					},
				},
			});
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	test("updateGlobalConfig patches runtime globals while preserving agents and unknown fields", () => {
		const dir = tmp();
		try {
			writeFileSync(
				join(dir, "config.json"),
				JSON.stringify(
					{
						autoCompact: true,
						host: "127.0.0.1",
						heartbeat: {
							intervalMinutes: 30,
							deferMinutes: 0,
						},
						port: 4000,
						custom: {
							flag: true,
						},
						agents: {
							"agent-railly": {
								telegram: {
									botToken: "token-a",
									allowedUsers: [101],
								},
							},
						},
					},
					null,
					"\t",
				),
			);

			const config = updateGlobalConfig(dir, {
				autoCompact: false,
				host: "0.0.0.0",
				heartbeat: {
					intervalMinutes: 60,
				},
				port: 4100,
			});

			expect(config).toEqual({
				autoCompact: false,
				host: "0.0.0.0",
				heartbeat: {
					intervalMinutes: 60,
					deferMinutes: 0,
				},
				port: 4100,
			});
			expect(
				JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")),
			).toEqual({
				autoCompact: false,
				host: "0.0.0.0",
				heartbeat: {
					intervalMinutes: 60,
					deferMinutes: 0,
				},
				port: 4100,
				custom: {
					flag: true,
				},
				agents: {
					"agent-railly": {
						rollover: {
							idleMinutes: 480,
						},
						telegram: {
							botToken: "token-a",
							allowedUsers: [101],
						},
					},
				},
			});
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});
