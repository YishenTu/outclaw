import {
	type EffortLevel,
	resolveCompatibleEffort,
} from "../../../common/commands.ts";
import {
	contextWindowForAlias,
	isModelAlias,
	type ModelAlias,
} from "../../../common/models.ts";
import type {
	DoneEvent,
	ImageRef,
	RuntimeStatusEvent,
	UsageInfo,
} from "../../../common/protocol.ts";
import { PENDING_SESSION_TITLE } from "../../../common/session-title.ts";
import { recalculateUsageForContextWindow } from "../../../common/usage.ts";
import type { LastUserTarget } from "../../persistence/last-user-target.ts";
import type { SessionRow } from "../../persistence/session-store/session-store.ts";
import { RuntimeSessionState } from "./runtime-session-state.ts";
import { RuntimeSettingsState } from "./runtime-settings-state.ts";

export interface RuntimePromptContext {
	effort: EffortLevel;
	fallbackSessionTitle?: string;
	generation: number;
	model: string;
	ocSessionId: string;
	/**
	 * Provider id that owns this prompt run. Lane keys, prompt routing, and
	 * session-storage writes must be scoped by this value — a Codex chat and
	 * a Claude chat with the same sdk session id never share state.
	 */
	providerId: string;
	resolvedModel: string;
	sessionId?: string;
	sessionSource: "tui" | "telegram" | "agent";
	sessionTitle?: string;
}

interface RuntimeStateOptions {
	defaultEffort?: EffortLevel;
}

export function resolveSessionTitleForPersistence(params: {
	existingTitle?: string | null;
	fallbackSessionTitle?: string | null;
	sessionTitle?: string | null;
}): string {
	if (params.sessionTitle !== undefined && params.sessionTitle !== null) {
		return params.sessionTitle;
	}
	if (
		params.fallbackSessionTitle !== undefined &&
		params.fallbackSessionTitle !== null
	) {
		return PENDING_SESSION_TITLE;
	}
	return params.existingTitle ?? "Untitled";
}

export class RuntimeState {
	private readonly sessions = new RuntimeSessionState();
	private readonly settings: RuntimeSettingsState;
	private currentProviderId: string;

	constructor(
		initialProviderId: string,
		private readonly agentName?: string,
		options: RuntimeStateOptions = {},
	) {
		this.currentProviderId = initialProviderId;
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

	get model(): string {
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

	get sessionTitleFallback(): string | undefined {
		return this.sessions.sessionTitleFallback;
	}

	get usage(): UsageInfo | undefined {
		return this.sessions.usage;
	}

	capturePromptContext(): RuntimePromptContext {
		return {
			effort: this.settings.effort,
			fallbackSessionTitle: this.sessions.sessionTitleFallback,
			generation: this.sessions.generation,
			model: this.settings.model,
			ocSessionId: this.sessions.ensureOcSessionId(),
			providerId: this.currentProviderId,
			resolvedModel: this.settings.resolvedModel,
			sessionId: this.sessions.sessionId,
			sessionSource: this.sessions.sessionSource,
			sessionTitle: this.sessions.sessionTitle,
		};
	}

	captureDetachedPromptContext(
		prompt: string,
		images?: ImageRef[],
		options: { resumeSessionId?: string } = {},
	): RuntimePromptContext {
		const detached = this.sessions.createDetachedPromptContext(prompt, images);
		return {
			effort: this.settings.effort,
			generation: this.sessions.generation,
			model: this.settings.model,
			ocSessionId: options.resumeSessionId ?? detached.ocSessionId,
			providerId: this.currentProviderId,
			resolvedModel: this.settings.resolvedModel,
			sessionId: options.resumeSessionId,
			sessionSource: "agent",
			sessionTitle: detached.sessionTitle,
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
		| import("../../../common/protocol.ts").HeartbeatDeliveryTarget
		| undefined {
		return this.createLastUserDeliveryTarget();
	}

	createLastUserDeliveryTarget():
		| import("../../../common/protocol.ts").HeartbeatDeliveryTarget
		| undefined {
		return this.sessions.createLastUserDeliveryTarget();
	}

	preparePrompt(
		prompt: string,
		images?: ImageRef[],
		options?: { deferTitle?: boolean },
	) {
		this.sessions.preparePrompt(prompt, images, options);
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

	/**
	 * Set the active provider-local model id. Use for non-Claude providers
	 * whose model ids don't fit the `ModelAlias` registry (e.g. `gpt-5.5`).
	 * Claude paths continue to call `setModel(alias)`.
	 */
	setProviderModel(model: string) {
		this.settings.setProviderModel(model);
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
		} else if (params.session) {
			this.setProviderModel(params.session.model);
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
		// The visible provider is derived from the session being activated.
		// Multi-provider chat runtimes can hold sessions from any configured
		// provider; resuming one switches the active provider so prompt
		// routing, runtime status, and the model selector follow.
		this.currentProviderId = session.providerId;

		if (isModelAlias(session.model)) {
			this.setModel(session.model);
			usage = this.alignUsageToModel(usage, session.model);
		} else {
			this.setProviderModel(session.model);
		}
		this.sessions.switchToSession(session, usage);
	}

	/**
	 * Set the runtime's active chat provider id. Only callable when there is
	 * no visible session — provider changes through `/model` or
	 * `model_select` while a session is active must be rejected; the runtime
	 * crosses provider boundaries through `switchToSession()` or `/new`.
	 */
	setProvider(providerId: string) {
		if (this.sessions.sessionId !== undefined) {
			throw new Error(
				"Cannot change provider while a chat session is active; start a new session first",
			);
		}
		this.currentProviderId = providerId;
	}

	completeRun(event: DoneEvent, source?: string, telegramChatId?: number) {
		this.sessions.completeRun(event, source, telegramChatId);
	}

	initializeRun(sessionId: string, source?: string) {
		this.sessions.initializeRun(sessionId, source);
	}

	matchesVisiblePromptContext(context: RuntimePromptContext): boolean {
		if (context.sessionId) {
			return (
				this.currentProviderId === context.providerId &&
				this.sessions.sessionId === context.sessionId
			);
		}

		return (
			this.currentProviderId === context.providerId &&
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
		const compatibleEffort = resolveCompatibleEffort({
			effort: this.settings.effort,
			fallbackEffort: this.settings.defaultEffort,
			model,
		});
		if (compatibleEffort !== this.settings.effort) {
			this.settings.setEffort(compatibleEffort);
		}
	}
}
