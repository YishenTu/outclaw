import type {
	DoneEvent,
	HeartbeatDeliveryTarget,
	ImageRef,
	UsageInfo,
} from "../../common/protocol.ts";
import type { LastUserTarget } from "../persistence/last-user-target.ts";
import type { SessionRow } from "../persistence/session-store.ts";

export class RuntimeSessionState {
	private activeSessionId: string | undefined;
	private activeSessionSource: "tui" | "telegram" | "agent" = "tui";
	private currentTitle: string | undefined;
	private lastUserTarget: LastUserTarget | undefined;
	private lastUsage: UsageInfo | undefined;
	private currentGeneration = 0;

	get generation(): number {
		return this.currentGeneration;
	}

	get sessionId(): string | undefined {
		return this.activeSessionId;
	}

	get sessionSource(): "tui" | "telegram" | "agent" {
		return this.activeSessionSource;
	}

	get sessionTitle(): string | undefined {
		return this.currentTitle;
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

	createHeartbeatDeliveryTarget(): HeartbeatDeliveryTarget | undefined {
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

	preparePrompt(prompt: string, images?: ImageRef[]) {
		if (!this.activeSessionId && !this.currentTitle) {
			const title = deriveSessionTitle(prompt, images);
			if (title) {
				this.currentTitle = title;
			}
		}
	}

	clearSession() {
		this.currentGeneration++;
		this.activeSessionId = undefined;
		this.activeSessionSource = "tui";
		this.currentTitle = undefined;
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
		this.currentTitle = params.session.title;
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
		}
	}

	switchToSession(session: SessionRow, usage?: UsageInfo) {
		this.currentGeneration++;
		this.activeSessionId = session.sdkSessionId;
		this.currentTitle = session.title;
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

	completeRun(event: DoneEvent, source?: string, _telegramChatId?: number) {
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

		this.activeSessionId = event.sessionId;
		this.lastUsage = event.usage;
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
