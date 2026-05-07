import { randomUUID } from "node:crypto";
import type {
	DoneEvent,
	HeartbeatDeliveryTarget,
	ImageRef,
	UsageInfo,
} from "../../../common/protocol.ts";
import type { LastUserTarget } from "../../persistence/last-user-target.ts";
import type { SessionRow } from "../../persistence/session-store/session-store.ts";

export class RuntimeSessionState {
	private activeSessionId: string | undefined;
	private activeOcSessionId: string | undefined;
	private activeSessionSource: "tui" | "telegram" | "agent" = "tui";
	private currentTitle: string | undefined;
	private deferredFallbackTitle: string | undefined;
	private lastUserTarget: LastUserTarget | undefined;
	private lastUsage: UsageInfo | undefined;
	private currentGeneration = 0;

	get generation(): number {
		return this.currentGeneration;
	}

	get sessionId(): string | undefined {
		return this.activeSessionId;
	}

	get ocSessionId(): string | undefined {
		return this.activeOcSessionId;
	}

	get sessionSource(): "tui" | "telegram" | "agent" {
		return this.activeSessionSource;
	}

	get sessionTitle(): string | undefined {
		return this.currentTitle;
	}

	get sessionTitleFallback(): string | undefined {
		return this.deferredFallbackTitle;
	}

	get usage(): UsageInfo | undefined {
		return this.lastUsage;
	}

	setUsage(usage: UsageInfo | undefined) {
		this.lastUsage = usage;
	}

	getLastUserTarget(): LastUserTarget | undefined {
		return this.lastUserTarget;
	}

	createLastUserDeliveryTarget(): HeartbeatDeliveryTarget | undefined {
		if (!this.lastUserTarget) {
			return undefined;
		}

		if (this.lastUserTarget?.kind === "telegram") {
			return {
				clientType: "telegram",
				telegramChatId: this.lastUserTarget.chatId,
			};
		}

		return {
			clientType: "tui",
		};
	}

	createHeartbeatDeliveryTarget(): HeartbeatDeliveryTarget | undefined {
		return this.createLastUserDeliveryTarget();
	}

	preparePrompt(
		prompt: string,
		images?: ImageRef[],
		options: { deferTitle?: boolean } = {},
	) {
		if (!this.activeOcSessionId) {
			this.activeOcSessionId = randomUUID();
		}
		if (
			!this.activeSessionId &&
			!this.currentTitle &&
			!this.deferredFallbackTitle
		) {
			const title = deriveSessionTitle(prompt, images);
			if (title) {
				if (options.deferTitle) {
					this.deferredFallbackTitle = title;
				} else {
					this.currentTitle = title;
				}
			}
		}
	}

	ensureOcSessionId(): string {
		if (!this.activeOcSessionId) {
			this.activeOcSessionId = randomUUID();
		}
		return this.activeOcSessionId;
	}

	clearSession() {
		this.currentGeneration++;
		this.activeSessionId = undefined;
		this.activeOcSessionId = undefined;
		this.activeSessionSource = "tui";
		this.currentTitle = undefined;
		this.deferredFallbackTitle = undefined;
		this.lastUsage = undefined;
	}

	restorePersistedState(params: {
		lastUserTarget?: LastUserTarget;
		session?: SessionRow;
		usage?: UsageInfo;
	}) {
		this.lastUserTarget = params.lastUserTarget;
		if (!params.session) {
			return;
		}

		this.activeSessionId = params.session.sdkSessionId;
		// The persisted provider session id is canonical. Older rows may still
		// carry a legacy ocSessionId alias; keep selector compatibility in the
		// store, but export the canonical id to the runtime/tool env so new notes
		// and transcript lookup converge.
		this.activeOcSessionId = params.session.sdkSessionId;
		this.currentTitle = params.session.title;
		this.deferredFallbackTitle = undefined;
		this.activeSessionSource =
			params.session.source === "telegram"
				? "telegram"
				: params.session.source === "agent"
					? "agent"
					: "tui";
		this.lastUsage = params.usage;
	}

	renameSession(sessionId: string, title: string) {
		if (this.activeSessionId === sessionId) {
			this.currentTitle = title;
			this.deferredFallbackTitle = undefined;
		}
	}

	switchToSession(session: SessionRow, usage?: UsageInfo) {
		this.currentGeneration++;
		this.activeSessionId = session.sdkSessionId;
		this.activeOcSessionId = session.sdkSessionId;
		this.currentTitle = session.title;
		this.deferredFallbackTitle = undefined;
		this.activeSessionSource =
			session.source === "telegram"
				? "telegram"
				: session.source === "agent"
					? "agent"
					: "tui";
		this.lastUsage = usage;
	}

	setLastUserTarget(target: LastUserTarget | undefined) {
		this.lastUserTarget = target;
	}

	initializeRun(sessionId: string, source?: string) {
		this.setSessionSource(source);
		this.activeSessionId = sessionId;
		if (!this.activeOcSessionId) {
			this.activeOcSessionId = sessionId;
		}
	}

	completeRun(event: DoneEvent, source?: string, _telegramChatId?: number) {
		this.setSessionSource(source);
		this.activeSessionId = event.sessionId;
		if (!this.activeOcSessionId) {
			this.activeOcSessionId = event.sessionId;
		}
		this.lastUsage = event.usage;
	}

	private setSessionSource(source?: string) {
		if (source === "telegram") {
			this.activeSessionSource = "telegram";
		} else if (
			source === "tui" ||
			source === "browser" ||
			source === undefined
		) {
			this.activeSessionSource = "tui";
		} else if (source === "agent" && this.activeSessionId === undefined) {
			this.activeSessionSource = "agent";
		}
	}
}

function deriveSessionTitle(
	prompt: string,
	images?: ImageRef[],
): string | undefined {
	const trimmedPrompt = prompt.trim();
	if (trimmedPrompt) {
		return trimmedPrompt.slice(0, 100);
	}

	const imageCount = images?.length ?? 0;
	if (imageCount === 1) {
		return "Image";
	}
	if (imageCount > 1) {
		return `${imageCount} images`;
	}

	return undefined;
}
