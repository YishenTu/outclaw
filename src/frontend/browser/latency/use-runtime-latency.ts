import { useEffect } from "react";
import { fetchRuntimeLatency } from "../lib/api.ts";
import { useRuntimeStore } from "../stores/runtime.ts";
import {
	measureRuntimeLatency,
	RUNTIME_LATENCY_POLL_INTERVAL_MS,
} from "./runtime-latency.ts";

export function useRuntimeLatencyPolling() {
	const connectionStatus = useRuntimeStore((state) => state.connectionStatus);

	useEffect(() => {
		if (connectionStatus !== "connected") {
			useRuntimeStore.getState().setLatency({
				rttMs: null,
				status: "idle",
			});
			return;
		}

		if (typeof document === "undefined") {
			return;
		}

		let cancelled = false;
		let inFlight = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		function clearTimer() {
			if (timer === undefined) {
				return;
			}
			clearTimeout(timer);
			timer = undefined;
		}

		function scheduleNext() {
			clearTimer();
			timer = setTimeout(runProbe, RUNTIME_LATENCY_POLL_INTERVAL_MS);
		}

		function markMeasuring() {
			const previous = useRuntimeStore.getState().latency;
			useRuntimeStore.getState().setLatency({
				rttMs: previous.rttMs,
				status: "measuring",
			});
		}

		function runProbe() {
			clearTimer();
			if (cancelled) {
				return;
			}
			if (document.visibilityState !== "visible") {
				scheduleNext();
				return;
			}
			if (inFlight) {
				return;
			}

			inFlight = true;
			markMeasuring();
			void measureRuntimeLatency({
				fetchProbe: (signal) => fetchRuntimeLatency(signal),
			})
				.then((measurement) => {
					if (cancelled) {
						return;
					}
					if (measurement.status === "ready") {
						useRuntimeStore.getState().setLatency({
							rttMs: measurement.rttMs,
							status: "ready",
						});
						return;
					}
					useRuntimeStore.getState().setLatency({
						rttMs: null,
						status: measurement.status,
					});
				})
				.finally(() => {
					inFlight = false;
					if (!cancelled) {
						scheduleNext();
					}
				});
		}

		function handleVisibilityChange() {
			if (document.visibilityState === "visible") {
				runProbe();
			}
		}

		runProbe();
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			cancelled = true;
			clearTimer();
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [connectionStatus]);
}
