import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EffortLevel,
} from "../../common/commands.ts";
import {
	isModelAlias,
	type ModelAlias,
	resolveModelAlias,
} from "../../common/models.ts";
import type {
	DoneEvent,
	HeartbeatDeliveryTarget,
	ImageRef,
	RuntimeStatusEvent,
	UsageInfo,
} from "../../common/protocol.ts";
import { SessionManager } from "../persistence/session-manager.ts";
import type { SessionRow, SessionStore } from "../persistence/session-store.ts";

export class RuntimeState {
	private activeModel: ModelAlias = DEFAULT_MODEL;
	private activeEffort: EffortLevel = DEFAULT_EFFORT;
	private lastUsage: UsageInfo | undefined;
	private lastTelegramChatId: number | undefined;
	private session: SessionManager;
	private _generation = 0;
	private store?: SessionStore;

	constructor(store?: SessionStore) {
		this.store = store;
		this.session = new SessionManager(store);
		this.lastTelegramChatId = store?.getLastTelegramChatId();
		if (this.session.id) {
			this.lastUsage = store?.getUsage(this.session.id);
		}
	}

	get generation(): number {
		return this._generation;
	}

	get effort(): EffortLevel {
		return this.activeEffort;
	}

	get model(): ModelAlias {
		return this.activeModel;
	}

	getLastTelegramChatId(): number | undefined {
		return this.lastTelegramChatId;
	}

	get resolvedModel(): string {
		return resolveModelAlias(this.activeModel);
	}

	get sessionId(): string | undefined {
		return this.session.id;
	}

	get sessionTitle(): string | undefined {
		return this.session.title;
	}

	createHeartbeatDeliveryTarget(): HeartbeatDeliveryTarget {
		if (this.session.source === "telegram") {
			return {
				clientType: "telegram",
				telegramChatId: this.lastTelegramChatId,
			};
		}

		return {
			clientType: "tui",
		};
	}

	createStatusEvent(): RuntimeStatusEvent {
		return {
			type: "runtime_status",
			model: this.activeModel,
			effort: this.activeEffort,
			sessionId: this.session.id,
			sessionTitle: this.session.title,
			usage: this.lastUsage,
		};
	}

	preparePrompt(prompt: string, images?: ImageRef[]) {
		if (!this.session.id && !this.session.title) {
			const title = deriveSessionTitle(prompt, images);
			if (title) {
				this.session.setTitle(title);
			}
		}
	}

	clearSession() {
		this._generation++;
		this.session.clear();
		this.lastUsage = undefined;
	}

	setModel(model: ModelAlias) {
		this.activeModel = model;
	}

	setEffort(effort: EffortLevel) {
		this.activeEffort = effort;
	}

	renameSession(sessionId: string, title: string) {
		if (this.session.id === sessionId) {
			this.session.setTitle(title);
		}
		this.store?.rename(sessionId, title);
	}

	switchToSession(session: SessionRow) {
		this._generation++;
		this.session.setTitle(session.title);
		this.session.update(session.sdkSessionId, session.model);
		if (isModelAlias(session.model)) {
			this.activeModel = session.model;
		}
		this.lastUsage = this.store?.getUsage(session.sdkSessionId);
	}

	completeRun(event: DoneEvent, source?: string, telegramChatId?: number) {
		if (source === "telegram") {
			this.session.update(event.sessionId, this.activeModel, "telegram");
			if (telegramChatId !== undefined) {
				this.lastTelegramChatId = telegramChatId;
				this.store?.setLastTelegramChatId(telegramChatId);
			}
		} else if (source === "heartbeat") {
			this.session.update(event.sessionId, this.activeModel);
		} else {
			this.session.update(event.sessionId, this.activeModel, "tui");
		}
		this.lastUsage = event.usage;
		if (event.usage && event.sessionId) {
			this.store?.setUsage(event.sessionId, event.usage);
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
