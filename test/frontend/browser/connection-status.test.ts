import { describe, expect, test } from "bun:test";
import {
	describeRuntimeConnectionStatus,
	formatRuntimeLatencyLabel,
} from "../../../src/frontend/browser/components/agent-sidebar/sidebar-runtime-status.tsx";

describe("describeRuntimeConnectionStatus", () => {
	test("returns the connected presentation", () => {
		expect(describeRuntimeConnectionStatus("connected")).toEqual({
			dotClassName: "bg-success",
			label: "Connected",
		});
	});

	test("returns the connecting presentation", () => {
		expect(describeRuntimeConnectionStatus("connecting")).toEqual({
			dotClassName: "bg-warning",
			label: "Connecting",
		});
	});

	test("returns the disconnected presentation", () => {
		expect(describeRuntimeConnectionStatus("disconnected")).toEqual({
			dotClassName: "bg-danger",
			label: "Offline",
		});
	});
});

describe("formatRuntimeLatencyLabel", () => {
	test("formats connected RTT measurements", () => {
		expect(
			formatRuntimeLatencyLabel("connected", {
				rttMs: 4,
				status: "ready",
			}),
		).toBe("RTT 4ms");
	});

	test("keeps latency scoped to connected runtime status", () => {
		expect(
			formatRuntimeLatencyLabel("disconnected", {
				rttMs: 4,
				status: "ready",
			}),
		).toBeNull();
	});

	test("formats transient and failed measurements", () => {
		expect(
			formatRuntimeLatencyLabel("connected", {
				rttMs: null,
				status: "measuring",
			}),
		).toBe("RTT ...");
		expect(
			formatRuntimeLatencyLabel("connected", {
				rttMs: null,
				status: "timeout",
			}),
		).toBe("RTT timeout");
		expect(
			formatRuntimeLatencyLabel("connected", {
				rttMs: null,
				status: "error",
			}),
		).toBe("RTT --");
	});
});
