import type { SessionCursor } from "../../../common/protocol.ts";

export interface SessionSummary {
	providerId?: string;
	sdkSessionId: string;
	title: string;
	model: string;
	lastActive: number;
}

export interface SessionMenuData {
	activeSessionId?: string;
	activeProviderId?: string;
	nextCursor?: SessionCursor;
	searchQuery?: string;
	sessions: SessionSummary[];
}

export interface SessionMenuChoice extends SessionSummary {
	active: boolean;
}
