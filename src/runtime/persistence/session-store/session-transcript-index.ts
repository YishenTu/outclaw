import type { Database } from "bun:sqlite";
import type { TranscriptTurn } from "../../../common/protocol.ts";
import { formatSearchTranscriptTurnBody } from "../../../common/transcript-turn-body.ts";

export class SessionTranscriptIndex {
	constructor(
		private readonly getDb: () => Database,
		private readonly agentId: string,
	) {}

	replace(providerId: string, sdkSessionId: string, turns: TranscriptTurn[]) {
		const searchableTurns = turns
			.map((turn) => ({
				bodyText: formatSearchTranscriptTurnBody(turn),
				role: turn.role,
				timestamp: turn.timestamp,
			}))
			.filter((turn) => turn.bodyText !== "");

		this.getDb().transaction(() => {
			this.getDb()
				.query(
					`DELETE FROM transcript_turns
					 WHERE agent_id = $agentId
					   AND provider_id = $providerId
					   AND sdk_session_id = $id`,
				)
				.run({
					$agentId: this.agentId,
					$providerId: providerId,
					$id: sdkSessionId,
				});

			const insert = this.getDb().query(
				`INSERT INTO transcript_turns (
						agent_id,
						provider_id,
						sdk_session_id,
						turn_index,
						role,
						body_text,
						timestamp
					)
					VALUES (
						$agentId,
						$providerId,
						$id,
						$turnIndex,
						$role,
						$bodyText,
						$timestamp
					)`,
			);

			for (const [index, turn] of searchableTurns.entries()) {
				insert.run({
					$agentId: this.agentId,
					$providerId: providerId,
					$id: sdkSessionId,
					$turnIndex: index,
					$role: turn.role,
					$bodyText: turn.bodyText,
					$timestamp: turn.timestamp,
				});
			}
		})();
	}
}
