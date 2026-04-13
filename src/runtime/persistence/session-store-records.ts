import type { UsageInfo } from "../../common/protocol.ts";

export type SessionTag = "chat" | "cron";

export interface SessionRow {
	providerId: string;
	sdkSessionId: string;
	title: string;
	model: string;
	source: string;
	tag: SessionTag;
	createdAt: number;
	lastActive: number;
}

export interface TableColumnInfo {
	name: string;
	pk: number;
}

export const SESSION_USAGE_COLUMNS = [
	"input_tokens",
	"output_tokens",
	"cache_creation_tokens",
	"cache_read_tokens",
	"context_window",
	"max_output_tokens",
	"context_tokens",
	"percentage",
] as const;

export const SESSION_TABLE_COLUMNS = [
	"provider_id",
	"sdk_session_id",
	"title",
	"model",
	"source",
	"tag",
	"created_at",
	"last_active",
	...SESSION_USAGE_COLUMNS,
] as const;

interface SessionDatabaseRow {
	provider_id: string;
	sdk_session_id: string;
	title: string;
	model: string;
	source: string;
	tag: SessionTag;
	created_at: number;
	last_active: number;
}

interface SessionUsageRow {
	input_tokens: number | null;
	output_tokens: number | null;
	cache_creation_tokens: number | null;
	cache_read_tokens: number | null;
	context_window: number | null;
	max_output_tokens: number | null;
	context_tokens: number | null;
	percentage: number | null;
}

export function mapSessionRow(
	row: SessionDatabaseRow | null | undefined,
): SessionRow | undefined {
	if (!row) {
		return undefined;
	}

	return {
		providerId: row.provider_id,
		sdkSessionId: row.sdk_session_id,
		title: row.title,
		model: row.model,
		source: row.source,
		tag: row.tag,
		createdAt: row.created_at,
		lastActive: row.last_active,
	};
}

export function mapSessionRows(rows: SessionDatabaseRow[]): SessionRow[] {
	return rows.map((row) => ({
		providerId: row.provider_id,
		sdkSessionId: row.sdk_session_id,
		title: row.title,
		model: row.model,
		source: row.source,
		tag: row.tag,
		createdAt: row.created_at,
		lastActive: row.last_active,
	}));
}

export function mapUsageRow(
	row: SessionUsageRow | null | undefined,
): UsageInfo | undefined {
	if (!row || row.context_window === null) {
		return undefined;
	}

	return {
		inputTokens: row.input_tokens ?? 0,
		outputTokens: row.output_tokens ?? 0,
		cacheCreationTokens: row.cache_creation_tokens ?? 0,
		cacheReadTokens: row.cache_read_tokens ?? 0,
		contextWindow: row.context_window,
		maxOutputTokens: row.max_output_tokens ?? 0,
		contextTokens: row.context_tokens ?? 0,
		percentage: row.percentage ?? 0,
	};
}
