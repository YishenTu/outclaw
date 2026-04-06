export class SessionManager {
	private activeSessionId: string | undefined;

	get id(): string | undefined {
		return this.activeSessionId;
	}

	update(sessionId: string) {
		this.activeSessionId = sessionId;
	}

	clear() {
		this.activeSessionId = undefined;
	}
}
