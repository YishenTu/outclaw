import { useEffect } from "react";
import type { FrontendNotice } from "../../common/protocol.ts";
import {
	selectVisibleRuntimeNotice,
	useRuntimeStore,
} from "./stores/runtime.ts";

export const ROLLOVER_NOTICE_AUTO_DISMISS_MS = 5_000;

type TimerHandle = unknown;

export function scheduleRolloverNoticeAutoDismiss(options: {
	notice: FrontendNotice | null;
	onDismiss: () => void;
	delayMs?: number;
	setTimeoutFn?: (handler: () => void, timeout: number) => TimerHandle;
	clearTimeoutFn?: (timer: TimerHandle) => void;
}): () => void {
	if (options.notice?.kind !== "rollover") {
		return () => {};
	}

	const setTimeoutFn =
		options.setTimeoutFn ??
		((handler: () => void, timeout: number) => setTimeout(handler, timeout));
	const clearTimeoutFn =
		options.clearTimeoutFn ??
		((timer: TimerHandle) =>
			clearTimeout(timer as ReturnType<typeof setTimeout>));
	const timer = setTimeoutFn(
		options.onDismiss,
		options.delayMs ?? ROLLOVER_NOTICE_AUTO_DISMISS_MS,
	);

	return () => {
		clearTimeoutFn(timer);
	};
}

export function useRolloverNoticeAutoDismiss() {
	const notice = useRuntimeStore(selectVisibleRuntimeNotice);
	const dismissNotice = useRuntimeStore((state) => state.dismissNotice);

	useEffect(
		() =>
			scheduleRolloverNoticeAutoDismiss({
				notice,
				onDismiss: dismissNotice,
			}),
		[dismissNotice, notice],
	);
}
