import type { RuntimeClientType } from "../../common/protocol.ts";
import type { SessionStore, SessionTag } from "./session-store.ts";

export class SessionManager {
	private activeSessionId: string | undefined;
	private currentSource: RuntimeClientType = "tui";
	private currentTitle: string | undefined;

	constructor(private store?: SessionStore) {
		this.activeSessionId = store?.getActiveSessionId();
		if (this.activeSessionId) {
			const row = store?.get(this.activeSessionId);
			this.currentTitle = row?.title;
			this.currentSource = row?.source === "telegram" ? "telegram" : "tui";
		}
	}

	get id(): string | undefined {
		return this.activeSessionId;
	}

	get title(): string | undefined {
		return this.currentTitle;
	}

	get source(): RuntimeClientType {
		return this.currentSource;
	}

	update(
		sessionId: string,
		model: string,
		source?: RuntimeClientType,
		tag?: SessionTag,
	) {
		const storedSession = this.store?.get(sessionId);
		const storedTitle = storedSession?.title;
		const title =
			sessionId === this.activeSessionId
				? (this.currentTitle ?? storedTitle)
				: (storedTitle ?? this.currentTitle);
		const fallbackSource =
			storedSession?.source === "telegram" ? "telegram" : "tui";
		const nextSource =
			source ??
			(sessionId === this.activeSessionId
				? this.currentSource
				: fallbackSource);
		const nextTag = tag ?? storedSession?.tag ?? "chat";

		this.activeSessionId = sessionId;
		this.currentTitle = title;
		this.currentSource = nextSource;
		this.store?.setActiveSessionId(sessionId);
		this.store?.upsert({
			sdkSessionId: sessionId,
			title: title ?? "Untitled",
			model,
			source: nextSource,
			tag: nextTag,
		});
	}

	setTitle(title: string) {
		this.currentTitle = title;
	}

	clear() {
		this.activeSessionId = undefined;
		this.currentSource = "tui";
		this.currentTitle = undefined;
		this.store?.setActiveSessionId(undefined);
	}
}
