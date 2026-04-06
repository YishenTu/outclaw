import type { SessionStore } from "./session-store.ts";

export class SessionManager {
	private activeSessionId: string | undefined;
	private currentTitle: string | undefined;

	constructor(private store?: SessionStore) {
		this.activeSessionId = store?.getActiveSessionId();
		if (this.activeSessionId) {
			this.currentTitle = store?.get(this.activeSessionId)?.title;
		}
	}

	get id(): string | undefined {
		return this.activeSessionId;
	}

	get title(): string | undefined {
		return this.currentTitle;
	}

	update(sessionId: string, model: string) {
		const storedTitle = this.store?.get(sessionId)?.title;
		const title =
			sessionId === this.activeSessionId
				? (this.currentTitle ?? storedTitle)
				: (storedTitle ?? this.currentTitle);

		this.activeSessionId = sessionId;
		this.currentTitle = title;
		this.store?.setActiveSessionId(sessionId);
		this.store?.upsert({
			sdkSessionId: sessionId,
			title: title ?? "Untitled",
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
