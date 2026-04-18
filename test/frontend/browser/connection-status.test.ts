import { describe, expect, test } from "bun:test";
import { describeRuntimeConnectionStatus } from "../../../src/frontend/browser/components/agent-sidebar/sidebar-runtime-status.tsx";

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
