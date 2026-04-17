import type { FrontendNotice } from "../../common/protocol.ts";

interface CreateFrontendNoticeWatcherOptions {
	readNotice: () => FrontendNotice | undefined;
	onChange: (notice: FrontendNotice | undefined) => void;
	pollIntervalMs?: number;
}

function noticeKey(notice: FrontendNotice | undefined): string {
	return notice?.kind ?? "";
}

export function createFrontendNoticeWatcher(
	options: CreateFrontendNoticeWatcherOptions,
) {
	const pollIntervalMs = options.pollIntervalMs ?? 1000;
	let timer: ReturnType<typeof setInterval> | undefined;
	let previousKey = noticeKey(options.readNotice());

	return {
		start() {
			if (timer) {
				return;
			}

			timer = setInterval(() => {
				const nextNotice = options.readNotice();
				const nextKey = noticeKey(nextNotice);
				if (nextKey === previousKey) {
					return;
				}

				previousKey = nextKey;
				options.onChange(nextNotice);
			}, pollIntervalMs);
		},
		stop() {
			if (!timer) {
				return;
			}
			clearInterval(timer);
			timer = undefined;
		},
	};
}
