import type { FrontendNotice } from "../../../common/protocol.ts";

export interface RuntimeNoticeProjection {
	detail: string;
	dismissible: boolean;
	key: string;
	title: string;
}

export function createRuntimeNoticeKey(
	notice: FrontendNotice | null | undefined,
): string | null {
	if (!notice) {
		return null;
	}

	if (notice.kind === "rollover") {
		return `rollover:${notice.message}`;
	}

	return notice.kind;
}

export function projectRuntimeNotice(
	notice: FrontendNotice | null | undefined,
): RuntimeNoticeProjection | null {
	if (!notice) {
		return null;
	}

	if (notice.kind === "restart_required") {
		return {
			key: "notice-restart",
			title: "Restart required",
			detail: "Changes won't update until the runtime restarts.",
			dismissible: false,
		};
	}

	if (notice.kind === "rollover") {
		return {
			key: "notice-rollover",
			title: "Session rollover",
			detail: notice.message,
			dismissible: true,
		};
	}

	return null;
}
