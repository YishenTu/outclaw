import type { Database } from "bun:sqlite";
import type { UsageInfo } from "../../../common/protocol.ts";
import { mapUsageRow } from "./session-store-records.ts";

export class SessionUsageStore {
	constructor(
		private readonly getDb: () => Database,
		private readonly agentId: string,
	) {}

	set(providerId: string, sdkSessionId: string, usage: UsageInfo) {
		this.getDb()
			.query(
				`UPDATE sessions SET
					input_tokens = $inputTokens,
					output_tokens = $outputTokens,
					cache_creation_tokens = $cacheCreationTokens,
					cache_read_tokens = $cacheReadTokens,
					context_window = $contextWindow,
					max_output_tokens = $maxOutputTokens,
					context_tokens = $contextTokens,
					percentage = $percentage
				WHERE agent_id = $agentId
				  AND provider_id = $providerId
				  AND sdk_session_id = $id`,
			)
			.run({
				$agentId: this.agentId,
				$providerId: providerId,
				$id: sdkSessionId,
				$inputTokens: usage.inputTokens,
				$outputTokens: usage.outputTokens,
				$cacheCreationTokens: usage.cacheCreationTokens,
				$cacheReadTokens: usage.cacheReadTokens,
				$contextWindow: usage.contextWindow,
				$maxOutputTokens: usage.maxOutputTokens,
				$contextTokens: usage.contextTokens,
				$percentage: usage.percentage,
			});
	}

	get(providerId: string, sdkSessionId: string): UsageInfo | undefined {
		return mapUsageRow(
			this.getDb()
				.query(
					`SELECT
						input_tokens,
						output_tokens,
						cache_creation_tokens,
						cache_read_tokens,
						context_window,
						max_output_tokens,
						context_tokens,
						percentage
					FROM sessions
					WHERE agent_id = $agentId
					  AND provider_id = $providerId
					  AND sdk_session_id = $id`,
				)
				.get({
					$agentId: this.agentId,
					$providerId: providerId,
					$id: sdkSessionId,
				}) as Parameters<typeof mapUsageRow>[0],
		);
	}
}
