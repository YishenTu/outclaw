import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EffortLevel,
	isModelAlias,
	type ModelAlias,
	resolveModelAlias,
} from "../../common/commands.ts";
import type {
	DoneEvent,
	RuntimeStatusEvent,
	UsageInfo,
} from "../../common/protocol.ts";
import { SessionManager } from "../persistence/session-manager.ts";
import type { SessionRow, SessionStore } from "../persistence/session-store.ts";

export class RuntimeState {
	private activeModel: ModelAlias = DEFAULT_MODEL;
	private activeEffort: EffortLevel = DEFAULT_EFFORT;
	private lastUsage: UsageInfo | undefined;
	private session: SessionManager;
	private _generation = 0;

	constructor(store?: SessionStore) {
		this.session = new SessionManager(store);
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

	get resolvedModel(): string {
		return resolveModelAlias(this.activeModel);
	}

	get sessionId(): string | undefined {
		return this.session.id;
	}

	get sessionTitle(): string | undefined {
		return this.session.title;
	}

	createStatusEvent(): RuntimeStatusEvent {
		return {
			type: "runtime_status",
			model: this.activeModel,
			effort: this.activeEffort,
			sessionId: this.session.id,
			usage: this.lastUsage,
		};
	}

	preparePrompt(prompt: string) {
		if (!this.session.id && !this.session.title) {
			this.session.setTitle(prompt.slice(0, 100));
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

	switchToSession(session: SessionRow) {
		this._generation++;
		this.session.setTitle(session.title);
		this.session.update(session.sdkSessionId, session.model);
		if (isModelAlias(session.model)) {
			this.activeModel = session.model;
		}
		this.lastUsage = undefined;
	}

	completeRun(event: DoneEvent, source?: string) {
		this.session.update(event.sessionId, this.activeModel, source);
		this.lastUsage = event.usage;
	}
}
