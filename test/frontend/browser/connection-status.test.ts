import { describe, expect, test } from "bun:test";
import { describeRuntimeConnectionStatus } from "../../../src/frontend/browser/components/agent-sidebar/sidebar-runtime-status.tsx";

describe("describeRuntimeConnectionStatus", () => {
	test("returns the connected presentation", () => {
		expect(describeRuntimeConnectionStatus("connected")).toEqual({
			dotClassName: "bg-emerald-400",
			label: "Connected",
		});
	});

	test("returns the connecting presentation", () => {
		expect(describeRuntimeConnectionStatus("connecting")).toEqual({
			dotClassName: "bg-amber-300",
			label: "Connecting",
		});
	});

	test("returns the disconnected presentation", () => {
		expect(describeRuntimeConnectionStatus("disconnected")).toEqual({
			dotClassName: "bg-red-300",
			label: "Offline",
		});
	});
});
