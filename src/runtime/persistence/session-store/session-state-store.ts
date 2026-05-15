import type { Database } from "bun:sqlite";
import type {
	FrontendNotice,
	RolloverNotice,
} from "../../../common/protocol.ts";
import {
	parseFrontendNotice,
	parseRolloverNotice,
	serializeFrontendNotice,
} from "../frontend-notice.ts";
import {
	type LastUserTarget,
	parseLastUserTarget,
	serializeLastUserTarget,
} from "../last-user-target.ts";
import {
	activeSessionKey,
	blankChatModelSelectionKey,
	browserClientAgentKey,
	FRONTEND_NOTICE_KEY,
	LAST_INTERACTIVE_AGENT_KEY,
	LEGACY_LAST_TUI_AGENT_KEY,
	lastHandledRolloverInteractiveAtKey,
	lastInteractiveAtKey,
	lastUserTargetKey,
	rolloverNoticeKey,
} from "../state-keys.ts";

/**
 * Per-agent persisted blank-session model selection. This is the single
 * source of truth for the provider/model/effort/service-tier that a new chat
 * session will inherit, and it determines which provider's
 * `active_session_id:{agentId}:{providerId}` row is the visible one after
 * daemon restart.
 */
export interface StoredBlankChatModelSelection {
	providerId: string;
	model: string;
	effort: string;
	serviceTier?: string;
}

export class SessionStateStore {
	constructor(
		private readonly getDb: () => Database,
		private readonly agentId: string,
	) {}

	getActiveSessionId(providerId: string): string | undefined {
		return this.getStateValue(activeSessionKey(this.agentId, providerId));
	}

	setActiveSessionId(providerId: string, id: string | undefined) {
		const key = activeSessionKey(this.agentId, providerId);
		if (id) {
			this.setStateValue(key, id);
			return;
		}

		this.deleteStateValue(key);
	}

	getLastUserTarget(): LastUserTarget | undefined {
		return parseLastUserTarget(
			this.getStateValue(lastUserTargetKey(this.agentId)),
		);
	}

	setLastUserTarget(target: LastUserTarget | undefined) {
		if (!target) {
			this.deleteStateValue(lastUserTargetKey(this.agentId));
			return;
		}

		this.setStateValue(
			lastUserTargetKey(this.agentId),
			serializeLastUserTarget(target),
		);
	}

	getLastInteractiveAt(): number | undefined {
		return parseStoredNumber(
			this.getStateValue(lastInteractiveAtKey(this.agentId)),
		);
	}

	setLastInteractiveAt(timestamp: number | undefined) {
		if (timestamp === undefined) {
			this.deleteStateValue(lastInteractiveAtKey(this.agentId));
			return;
		}

		this.setStateValue(lastInteractiveAtKey(this.agentId), String(timestamp));
	}

	getLastHandledRolloverInteractiveAt(): number | undefined {
		return parseStoredNumber(
			this.getStateValue(lastHandledRolloverInteractiveAtKey(this.agentId)),
		);
	}

	setLastHandledRolloverInteractiveAt(timestamp: number | undefined) {
		if (timestamp === undefined) {
			this.deleteStateValue(lastHandledRolloverInteractiveAtKey(this.agentId));
			return;
		}

		this.setStateValue(
			lastHandledRolloverInteractiveAtKey(this.agentId),
			String(timestamp),
		);
	}

	getRolloverNotice(): RolloverNotice | undefined {
		return parseRolloverNotice(
			this.getStateValue(rolloverNoticeKey(this.agentId)),
		);
	}

	setRolloverNotice(notice: RolloverNotice | undefined) {
		if (!notice) {
			this.deleteStateValue(rolloverNoticeKey(this.agentId));
			return;
		}

		this.setStateValue(
			rolloverNoticeKey(this.agentId),
			serializeFrontendNotice(notice),
		);
	}

	getLastInteractiveAgentId(): string | undefined {
		return this.getStateValue(LAST_INTERACTIVE_AGENT_KEY);
	}

	setLastInteractiveAgentId(agentId: string | undefined) {
		if (!agentId) {
			this.deleteStateValue(LAST_INTERACTIVE_AGENT_KEY);
			this.deleteStateValue(LEGACY_LAST_TUI_AGENT_KEY);
			return;
		}

		this.setStateValue(LAST_INTERACTIVE_AGENT_KEY, agentId);
		this.deleteStateValue(LEGACY_LAST_TUI_AGENT_KEY);
	}

	getBrowserClientAgentId(clientId: string): string | undefined {
		return this.getStateValue(browserClientAgentKey(clientId));
	}

	setBrowserClientAgentId(clientId: string, agentId: string | undefined) {
		const key = browserClientAgentKey(clientId);
		if (!agentId) {
			this.deleteStateValue(key);
			return;
		}

		this.setStateValue(key, agentId);
	}

	getBlankChatModelSelection(): StoredBlankChatModelSelection | undefined {
		const raw = this.getStateValue(blankChatModelSelectionKey(this.agentId));
		if (!raw) {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as Partial<StoredBlankChatModelSelection>;
			if (
				typeof parsed.providerId !== "string" ||
				typeof parsed.model !== "string" ||
				typeof parsed.effort !== "string"
			) {
				return undefined;
			}
			return {
				providerId: parsed.providerId,
				model: parsed.model,
				effort: parsed.effort,
				...(typeof parsed.serviceTier === "string"
					? { serviceTier: parsed.serviceTier }
					: {}),
			};
		} catch {
			return undefined;
		}
	}

	setBlankChatModelSelection(
		selection: StoredBlankChatModelSelection | undefined,
	) {
		const key = blankChatModelSelectionKey(this.agentId);
		if (!selection) {
			this.deleteStateValue(key);
			return;
		}
		this.setStateValue(key, JSON.stringify(selection));
	}

	getFrontendNotice(): FrontendNotice | undefined {
		return parseFrontendNotice(this.getStateValue(FRONTEND_NOTICE_KEY));
	}

	setFrontendNotice(notice: FrontendNotice | undefined) {
		if (!notice) {
			this.deleteStateValue(FRONTEND_NOTICE_KEY);
			return;
		}

		this.setStateValue(FRONTEND_NOTICE_KEY, serializeFrontendNotice(notice));
	}

	deleteAgentState(agentId: string) {
		this.getDb()
			.query(
				`DELETE FROM state
				 WHERE key LIKE $activeSessionPrefix
				    OR key = $lastUserTargetKey
				    OR (key LIKE $browserClientAgentPrefix AND value = $agentId)`,
			)
			.run({
				$agentId: agentId,
				$activeSessionPrefix: `${activeSessionKey(agentId, "")}%`,
				$browserClientAgentPrefix: `${browserClientAgentKey("")}%`,
				$lastUserTargetKey: lastUserTargetKey(agentId),
			});
		this.deleteStateValue(lastInteractiveAtKey(agentId));
		this.deleteStateValue(lastHandledRolloverInteractiveAtKey(agentId));
		this.deleteStateValue(rolloverNoticeKey(agentId));
		this.deleteStateValue(blankChatModelSelectionKey(agentId));

		if (this.getLastInteractiveAgentId() === agentId) {
			this.deleteStateValue(LAST_INTERACTIVE_AGENT_KEY);
			this.deleteStateValue(LEGACY_LAST_TUI_AGENT_KEY);
		}
	}

	migrateLegacyStateKeys() {
		const legacyAgentId = this.getStateValue(LEGACY_LAST_TUI_AGENT_KEY);
		if (!legacyAgentId) {
			return;
		}

		if (!this.getStateValue(LAST_INTERACTIVE_AGENT_KEY)) {
			this.setStateValue(LAST_INTERACTIVE_AGENT_KEY, legacyAgentId);
		}
		this.deleteStateValue(LEGACY_LAST_TUI_AGENT_KEY);
	}

	private deleteStateValue(key: string) {
		this.getDb().query("DELETE FROM state WHERE key = $key").run({ $key: key });
	}

	private getStateValue(key: string): string | undefined {
		const row = this.getDb()
			.query("SELECT value FROM state WHERE key = $key")
			.get({ $key: key }) as { value: string | null } | null;
		return row?.value ?? undefined;
	}

	private setStateValue(key: string, value: string) {
		this.getDb()
			.query("INSERT OR REPLACE INTO state (key, value) VALUES ($key, $value)")
			.run({ $key: key, $value: value });
	}
}

function parseStoredNumber(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
