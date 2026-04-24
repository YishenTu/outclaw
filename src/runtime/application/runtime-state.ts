import {
	DEFAULT_EFFORT,
	type EffortLevel,
	isOpusOnlyEffort,
} from "../../common/commands.ts";
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

export interface RuntimePromptContext {
	effort: EffortLevel;
	generation: number;
	model: ModelAlias;
	ocSessionId: string;
	resolvedModel: string;
	sessionId?: string;
	sessionSource: "tui" | "telegram" | "agent";
	sessionTitle?: string;
}

interface RuntimeStateOptions {
	defaultEffort?: EffortLevel;
}

export class RuntimeState {
	private readonly sessions = new RuntimeSessionState();
	private readonly settings: RuntimeSettingsState;

	constructor(
		private readonly currentProviderId: string,
		private readonly agentName?: string,
		options: RuntimeStateOptions = {},
	) {
		this.settings = new RuntimeSettingsState({
			defaultEffort: options.defaultEffort,
		});
	}

	get generation(): number {
		return this.sessions.generation;
	}

	get effort(): EffortLevel {
		return this.settings.effort;
	}

	get defaultEffort(): EffortLevel {
		return this.settings.defaultEffort;
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

	get ocSessionId(): string | undefined {
		return this.sessions.ocSessionId;
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

	capturePromptContext(): RuntimePromptContext {
		return {
			effort: this.settings.effort,
			generation: this.sessions.generation,
			model: this.settings.model,
			ocSessionId: this.sessions.ensureOcSessionId(),
			resolvedModel: this.settings.resolvedModel,
			sessionId: this.sessions.sessionId,
			sessionSource: this.sessions.sessionSource,
			sessionTitle: this.sessions.sessionTitle,
		};
	}

	createStatusEvent(): RuntimeStatusEvent {
		return {
			type: "runtime_status",
			agentName: this.agentName,
			providerId: this.currentProviderId,
			model: this.settings.model,
			effort: this.settings.effort,
			running: false,
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
		this.normalizeEffortForModel(model);
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
			this.setModel(params.session.model);
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
			this.setModel(session.model);
			usage = this.alignUsageToModel(usage, session.model);
		}
		this.sessions.switchToSession(session, usage);
	}

	completeRun(event: DoneEvent, source?: string, telegramChatId?: number) {
		this.sessions.completeRun(event, source, telegramChatId);
	}

	matchesVisiblePromptContext(context: RuntimePromptContext): boolean {
		if (context.sessionId) {
			return this.sessions.sessionId === context.sessionId;
		}

		return (
			this.sessions.sessionId === undefined &&
			this.sessions.generation === context.generation &&
			this.sessions.sessionTitle === context.sessionTitle
		);
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

	private normalizeEffortForModel(model: ModelAlias) {
		if (model === "opus" || !isOpusOnlyEffort(this.settings.effort)) {
			return;
		}

		this.settings.setEffort(this.resolveCompatibleDefaultEffort(model));
	}

	private resolveCompatibleDefaultEffort(model: ModelAlias): EffortLevel {
		if (model === "opus" || !isOpusOnlyEffort(this.settings.defaultEffort)) {
			return this.settings.defaultEffort;
		}

		return DEFAULT_EFFORT;
	}
}
