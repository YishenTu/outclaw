export interface SessionSummary {
	sdkSessionId: string;
	title: string;
	model: string;
	lastActive: number;
}

export interface SessionMenuData {
	activeSessionId?: string;
	sessions: SessionSummary[];
}

export interface SessionMenuChoice extends SessionSummary {
	active: boolean;
}
