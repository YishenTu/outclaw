import { describe, expect, test } from "bun:test";
import {
	measureRuntimeLatency,
	RUNTIME_LATENCY_POLL_INTERVAL_MS,
} from "../../../src/frontend/browser/latency/runtime-latency.ts";

function abortError() {
	return new DOMException("Aborted", "AbortError");
}

describe("runtime latency measurement", () => {
	test("uses a 10 second polling interval", () => {
		expect(RUNTIME_LATENCY_POLL_INTERVAL_MS).toBe(10_000);
	});

	test("measures rounded browser-to-runtime RTT", async () => {
		const times = [100, 104.4];
		const clearedTimers: number[] = [];

		await expect(
			measureRuntimeLatency({
				clearTimeout: (timer) => clearedTimers.push(timer),
				fetchProbe: async () => {},
				now: () => times.shift() ?? 104.4,
				setTimeout: () => 7,
				timeoutMs: 100,
			}),
		).resolves.toEqual({
			rttMs: 4,
			status: "ready",
		});
		expect(clearedTimers).toEqual([7]);
	});

	test("classifies aborted probes as timeouts", async () => {
		let fireTimeout: (() => void) | undefined;

		const result = measureRuntimeLatency({
			clearTimeout: () => {},
			fetchProbe: (signal) =>
				new Promise((_resolve, reject) => {
					if (signal.aborted) {
						reject(abortError());
						return;
					}
					signal.addEventListener("abort", () => reject(abortError()), {
						once: true,
					});
				}),
			now: () => 100,
			setTimeout: (callback) => {
				fireTimeout = callback;
				return 1;
			},
			timeoutMs: 25,
		});

		fireTimeout?.();
		await expect(result).resolves.toEqual({
			status: "timeout",
		});
	});
});
