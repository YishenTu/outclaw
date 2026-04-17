import type { EffortLevel } from "../../common/commands.ts";
import {
	contextWindowForAlias,
	isModelAlias,
	type ModelAlias,
} from "../../common/models.ts";
import type {
	DoneEvent,
	ImageRef,
	RuntimeStatusEvent,
	UsageInfo,
} from "../../common/protocol.ts";
import { recalculateUsageForContextWindow } from "../../common/usage.ts";
import type { LastUserTarget } from "../persistence/last-user-target.ts";
import type { SessionRow } from "../persistence/session-store.ts";
import { RuntimeSessionState } from "./runtime-session-state.ts";
import { RuntimeSettingsState } from "./runtime-settings-state.ts";

export class RuntimeState {
	private readonly sessions = new RuntimeSessionState();
	private readonly settings = new RuntimeSettingsState();

	constructor(
		private readonly currentProviderId: string,
		private readonly agentName?: string,
	) {}

	get generation(): number {
		return this.sessions.generation;
	}

	get effort(): EffortLevel {
		return this.settings.effort;
	}

	get model(): ModelAlias {
		return this.settings.model;
	}

	get providerId(): string {
		return this.currentProviderId;
	}

	getLastUserTarget(): LastUserTarget | undefined {
		return this.sessions.getLastUserTarget();
	}

	get resolvedModel(): string {
		return this.settings.resolvedModel;
	}

	get sessionId(): string | undefined {
		return this.sessions.sessionId;
	}

	get sessionSource(): "tui" | "telegram" | "agent" {
		return this.sessions.sessionSource;
	}

	get sessionTitle(): string | undefined {
		return this.sessions.sessionTitle;
	}

	get usage(): UsageInfo | undefined {
		return this.sessions.usage;
	}

	createStatusEvent(): RuntimeStatusEvent {
		return {
			type: "runtime_status",
			agentName: this.agentName,
			providerId: this.currentProviderId,
			model: this.settings.model,
			effort: this.settings.effort,
			sessionId: this.sessions.sessionId,
			sessionTitle: this.sessions.sessionTitle,
			usage: this.sessions.usage,
		};
	}

	createHeartbeatDeliveryTarget():
		| import("../../common/protocol.ts").HeartbeatDeliveryTarget
		| undefined {
		return this.sessions.createHeartbeatDeliveryTarget();
	}

	preparePrompt(prompt: string, images?: ImageRef[]) {
		this.sessions.preparePrompt(prompt, images);
	}

	clearSession() {
		this.sessions.clearSession();
	}

	setModel(model: ModelAlias) {
		this.settings.setModel(model);
		this.sessions.setUsage(this.alignUsageToModel(this.sessions.usage, model));
	}

	setEffort(effort: EffortLevel) {
		this.settings.setEffort(effort);
	}

	restorePersistedState(params: {
		lastUserTarget?: LastUserTarget;
		session?: SessionRow;
		usage?: UsageInfo;
	}) {
		let usage = params.usage;
		if (params.session && isModelAlias(params.session.model)) {
			this.settings.setModel(params.session.model);
			usage = this.alignUsageToModel(usage, params.session.model);
		}
		this.sessions.restorePersistedState({
			...params,
			usage,
		});
	}

	renameSession(sessionId: string, title: string) {
		this.sessions.renameSession(sessionId, title);
	}

	setLastUserTarget(target: LastUserTarget | undefined) {
		this.sessions.setLastUserTarget(target);
	}

	switchToSession(session: SessionRow, usage?: UsageInfo) {
		if (session.providerId !== this.currentProviderId) {
			throw new Error(
				`Cannot activate ${session.providerId} session in ${this.currentProviderId} runtime`,
			);
		}

		if (isModelAlias(session.model)) {
			this.settings.setModel(session.model);
			usage = this.alignUsageToModel(usage, session.model);
		}
		this.sessions.switchToSession(session, usage);
	}

	completeRun(event: DoneEvent, source?: string, telegramChatId?: number) {
		this.sessions.completeRun(event, source, telegramChatId);
	}

	private alignUsageToModel(
		usage: UsageInfo | undefined,
		model: ModelAlias,
	): UsageInfo | undefined {
		if (!usage) {
			return undefined;
		}

		const contextWindow = contextWindowForAlias(model);
		if (!contextWindow) {
			return usage;
		}

		return recalculateUsageForContextWindow(usage, contextWindow);
	}
}
