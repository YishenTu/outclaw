import type { BrowserCodingSessionRunStatus } from "../../../common/protocol.ts";

interface CodingSessionHydrationParams {
	cachedEventCount: number;
	runStatus: BrowserCodingSessionRunStatus;
}

export function shouldHydrateCodingSessionEvents({
	cachedEventCount,
	runStatus,
}: CodingSessionHydrationParams): boolean {
	return cachedEventCount === 0 || runStatus === "running";
}
