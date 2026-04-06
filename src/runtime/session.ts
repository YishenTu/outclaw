import type { SessionStore } from "./db.ts";

export class SessionManager {
	private activeSessionId: string | undefined;
	private currentTitle: string | undefined;

	constructor(private store?: SessionStore) {
		this.activeSessionId = store?.getActiveSessionId();
	}

	get id(): string | undefined {
		return this.activeSessionId;
	}

	update(sessionId: string, model: string) {
		this.activeSessionId = sessionId;
		this.store?.setActiveSessionId(sessionId);
		this.store?.upsert({
			sdkSessionId: sessionId,
			title: this.currentTitle ?? "Untitled",
			model,
		});
	}

	setTitle(title: string) {
		this.currentTitle = title;
	}

	clear() {
		this.activeSessionId = undefined;
		this.currentTitle = undefined;
		this.store?.setActiveSessionId(undefined);
	}
}
