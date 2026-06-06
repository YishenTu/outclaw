import { describe, expect, test } from "bun:test";
import type {
	NativeToolResult,
	OutclawCronData,
	OutclawCronParams,
	OutclawPeerMessageData,
	OutclawPeerMessageParams,
} from "../../../src/common/native-tools.ts";
import { createOutclawNativeToolHost } from "../../../src/runtime/native-tools/host.ts";

describe("Outclaw native tool host", () => {
	test("rejects state-changing and long-running modes in read-only contexts", async () => {
		const calls: string[] = [];
		const host = createOutclawNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "auto-title",
				readOnly: true,
			},
			handlers: {
				peerMessage: async (params) => {
					calls.push(params.mode);
					return peerMessageOk(params);
				},
			},
		});

		await expect(
			host.peerMessage({
				mode: "ask",
				targetAgent: "builder",
				message: "can you review this?",
			}),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "read_only_violation" },
		});
		await expect(
			host.peerMessage({
				mode: "send",
				targetAgent: "builder",
				message: "please review this",
			}),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "read_only_violation" },
		});
		expect(calls).toEqual([]);
	});

	test("rejects cron run recursion before delegation", async () => {
		const calls: string[] = [];
		const host = createOutclawNativeToolHost({
			context: {
				agentId: "agent-default",
				agentName: "Default",
				source: "cron",
				readOnly: false,
			},
			handlers: {
				peerMessage: async (params) => peerMessageOk(params),
				cron: async (params) => {
					calls.push(params.mode);
					return cronOk(params);
				},
			},
		});

		await expect(
			host.cron({ mode: "run", jobName: "nightly-summary" }),
		).resolves.toMatchObject({
			ok: false,
			error: { code: "context_disabled" },
		});
		expect(calls).toEqual([]);
	});
});

function peerMessageOk(
	params: OutclawPeerMessageParams,
): NativeToolResult<OutclawPeerMessageData> {
	if (params.mode === "list") {
		return {
			ok: true,
			data: {
				mode: "list",
				agents: [],
			},
		};
	}
	return {
		ok: true,
		data: {
			mode: params.mode,
			targetAgent: params.targetAgent,
			accepted: true,
		},
	};
}

function cronOk(params: OutclawCronParams): NativeToolResult<OutclawCronData> {
	if (params.mode === "failed_status") {
		return { ok: true, data: { mode: "failed_status", failures: [] } };
	}
	return {
		ok: true,
		data: {
			mode: "run",
			jobName: params.jobName,
			accepted: true,
		},
	};
}
