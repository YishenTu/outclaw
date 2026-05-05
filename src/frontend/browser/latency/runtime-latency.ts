export const RUNTIME_LATENCY_POLL_INTERVAL_MS = 10_000;
export const RUNTIME_LATENCY_TIMEOUT_MS = 3_000;

export type RuntimeLatencyMeasurement =
	| {
			rttMs: number;
			status: "ready";
	  }
	| {
			status: "timeout";
	  }
	| {
			status: "error";
	  };

interface MeasureRuntimeLatencyOptions<
	TimerHandle = ReturnType<typeof setTimeout>,
> {
	clearTimeout?: (timer: TimerHandle) => void;
	fetchProbe: (signal: AbortSignal) => Promise<unknown>;
	now?: () => number;
	setTimeout?: (callback: () => void, delayMs: number) => TimerHandle;
	timeoutMs?: number;
}

export async function measureRuntimeLatency<
	TimerHandle = ReturnType<typeof setTimeout>,
>({
	clearTimeout: clearProbeTimeout = (timer) =>
		clearTimeout(timer as ReturnType<typeof setTimeout>),
	fetchProbe,
	now = () => performance.now(),
	setTimeout: setProbeTimeout = (callback, delayMs) =>
		setTimeout(callback, delayMs) as TimerHandle,
	timeoutMs = RUNTIME_LATENCY_TIMEOUT_MS,
}: MeasureRuntimeLatencyOptions<TimerHandle>): Promise<RuntimeLatencyMeasurement> {
	const abortController = new AbortController();
	const startedAt = now();
	const timeout = setProbeTimeout(() => {
		abortController.abort();
	}, timeoutMs);

	try {
		await fetchProbe(abortController.signal);
		return {
			rttMs: Math.max(0, Math.round(now() - startedAt)),
			status: "ready",
		};
	} catch (error) {
		if (isAbortError(error)) {
			return {
				status: "timeout",
			};
		}
		return {
			status: "error",
		};
	} finally {
		clearProbeTimeout(timeout);
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
