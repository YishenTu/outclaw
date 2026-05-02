export interface ClaudeHistoryMessage {
	type: string;
	timestamp?: string;
	message?: unknown;
	subtype?: string;
	compactMetadata?: {
		trigger?: string;
		preTokens?: number;
	};
	compact_metadata?: {
		trigger?: string;
		pre_tokens?: number;
	};
	isMeta?: boolean;
	isCompactSummary?: boolean;
	isVisibleInTranscriptOnly?: boolean;
	isSidechain?: boolean;
	teamName?: string;
	toolUseResult?: unknown;
}

export type LoadClaudeHistory = (
	sdkSessionId: string,
	options?: { includeSystemMessages?: boolean },
) => Promise<ClaudeHistoryMessage[]>;
