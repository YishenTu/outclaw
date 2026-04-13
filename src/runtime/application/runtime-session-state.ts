import type {
	DoneEvent,
	HeartbeatDeliveryTarget,
	ImageRef,
	RuntimeClientType,
	UsageInfo,
} from "../../common/protocol.ts";
import type { SessionRow } from "../persistence/session-store.ts";

export class RuntimeSessionState {
	private activeSessionId: string | undefined;
	private activeSessionSource: RuntimeClientType = "tui";
	private currentTitle: string | undefined;
	private lastUsage: UsageInfo | undefined;
	private lastTelegramChatId: number | undefined;
	private currentGeneration = 0;

	get generation(): number {
		return this.currentGeneration;
	}

	get sessionId(): string | undefined {
		return this.activeSessionId;
	}

	get sessionSource(): RuntimeClientType {
		return this.activeSessionSource;
	}

	get sessionTitle(): string | undefined {
		return this.currentTitle;
	}

	get usage(): UsageInfo | undefined {
		return this.lastUsage;
	}

	getLastTelegramChatId(): number | undefined {
		return this.lastTelegramChatId;
	}

	createHeartbeatDeliveryTarget(): HeartbeatDeliveryTarget {
		if (this.activeSessionSource === "telegram") {
			return {
				clientType: "telegram",
				telegramChatId: this.lastTelegramChatId,
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
		lastTelegramChatId?: number;
		session?: SessionRow;
		usage?: UsageInfo;
	}) {
		this.lastTelegramChatId = params.lastTelegramChatId;
		if (!params.session) {
			return;
		}

		this.activeSessionId = params.session.sdkSessionId;
		this.currentTitle = params.session.title;
		this.activeSessionSource =
			params.session.source === "telegram" ? "telegram" : "tui";
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
			session.source === "telegram" ? "telegram" : "tui";
		this.lastUsage = usage;
	}

	completeRun(event: DoneEvent, source?: string, telegramChatId?: number) {
		if (source === "telegram") {
			this.activeSessionSource = "telegram";
			if (telegramChatId !== undefined) {
				this.lastTelegramChatId = telegramChatId;
			}
		} else if (source === "tui" || source === undefined) {
			this.activeSessionSource = "tui";
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
