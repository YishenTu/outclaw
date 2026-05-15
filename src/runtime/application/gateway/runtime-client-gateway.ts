import type {
	DisplayMessage,
	Facade,
	RuntimeStatusEvent,
	SkillInfo,
	StreamingSyncEvent,
	TranscriptTurn,
	WorkspaceFileEntry,
} from "../../../common/protocol.ts";
import { extractError } from "../../../common/protocol.ts";
import { annotateHistoryWithTranscript } from "../../../common/replay-history.ts";
import { ClientHub, type WsClient } from "../../transport/client-hub.ts";

interface RuntimeClientGatewayOptions {
	canSendToClient?: (ws: WsClient) => boolean;
	cwd?: string;
	/**
	 * Primary/default facade. The gateway resolves provider-specific surfaces
	 * through the optional resolver below when the current status includes a
	 * provider id, and falls back here for single-provider runtimes. The
	 * replay path resolves the per-session facade through
	 * `resolveFacadeForSession` so a Codex chat session's history is read
	 * by the Codex adapter, not Claude.
	 */
	facade: Facade;
	resolveFacadeForProvider?: (providerId: string) => Facade | undefined;
	/**
	 * Resolve the facade that owns a given persisted chat session. Returns
	 * undefined when the runtime has no record of the session — callers
	 * fall back to the primary facade in that case (e.g. a fresh blank
	 * session whose id only exists in the runtime status snapshot).
	 */
	resolveFacadeForSession?: (
		providerId: string | undefined,
		sessionId: string,
	) => Facade | undefined;
	getStreamingSyncEvent?: (
		providerId: string | undefined,
		sessionId: string,
	) => StreamingSyncEvent | undefined;
	getStatusEvent: () => RuntimeStatusEvent;
	listSkills?: () => Promise<SkillInfo[]>;
	listWorkspaceFiles?: () => Promise<WorkspaceFileEntry[]>;
}

interface ReplaySessionRef {
	providerId?: string;
	sdkSessionId: string;
}

export class RuntimeClientGateway {
	private hub = new ClientHub();

	constructor(private readonly options: RuntimeClientGatewayOptions) {}

	get clientHub(): ClientHub {
		return this.hub;
	}

	broadcastStatus() {
		this.hub.broadcast(this.options.getStatusEvent());
	}

	handleClose(ws: WsClient) {
		this.hub.remove(ws);
	}

	handleOpen(ws: WsClient) {
		this.hub.add(ws);
		this.hub.send(ws, this.options.getStatusEvent());
		void this.replayHistory([ws]);
	}

	listClients(): Iterable<WsClient> {
		return this.hub.list();
	}

	listInteractiveTargets(exclude?: WsClient): WsClient[] {
		return this.hub.listByTypes(["tui", "browser"], exclude);
	}

	listBrowserTargets(exclude?: WsClient): WsClient[] {
		return this.hub.listByType("browser", exclude);
	}

	replayHistory(
		targets: Iterable<WsClient>,
		sessionRef: ReplaySessionRef | string | undefined = statusSessionRef(
			this.options.getStatusEvent(),
		),
	) {
		const targetList = [...targets];
		const ref =
			typeof sessionRef === "string"
				? { sdkSessionId: sessionRef }
				: sessionRef;
		if (!ref?.sdkSessionId) {
			return Promise.resolve();
		}
		const sessionId = ref.sdkSessionId;
		const facade =
			this.options.resolveFacadeForSession?.(ref.providerId, sessionId) ??
			this.options.facade;
		if (!facade.readHistory && !facade.readReplay) {
			return Promise.resolve();
		}

		return safeInvoke(async () => {
			return await readReplayMessages(facade, sessionId);
		})
			.then((messages) => {
				if (!messages) {
					return;
				}
				this.hub.sendMany(targetList, {
					type: "history_replay",
					providerId: facade.providerId,
					sdkSessionId: sessionId,
					messages,
				});
				const streamingSync = this.options.getStreamingSyncEvent?.(
					ref.providerId,
					sessionId,
				);
				if (streamingSync) {
					this.hub.sendMany(targetList, {
						...streamingSync,
						providerId: streamingSync.providerId ?? facade.providerId,
					});
				}
			})
			.catch((error) => {
				this.hub.sendMany(targetList, {
					type: "error",
					message: `Failed to replay history: ${extractError(error)}`,
				});
			});
	}

	requestSkills(ws: WsClient) {
		if (!this.options.listSkills) {
			return;
		}

		void safeInvoke(() => this.options.listSkills?.())
			.then((skills) => {
				if (!skills) {
					return;
				}
				this.send(ws, { type: "skills_update", skills });
			})
			.catch((err) => {
				this.send(ws, {
					type: "error",
					message: extractError(err),
				});
			});
	}

	requestWorkspaceFiles(ws: WsClient) {
		if (!this.options.listWorkspaceFiles) {
			return;
		}

		void safeInvoke(() => this.options.listWorkspaceFiles?.())
			.then((entries) => {
				if (!entries) {
					return;
				}
				this.send(ws, { type: "workspace_files_update", entries });
			})
			.catch((err) => {
				this.send(ws, {
					type: "error",
					message: extractError(err),
				});
			});
	}

	send(ws: WsClient, event: Parameters<ClientHub["send"]>[1]) {
		if (this.options.canSendToClient && !this.options.canSendToClient(ws)) {
			return;
		}
		this.hub.send(ws, event);
	}

	sendMany(
		targets: Iterable<WsClient>,
		event: Parameters<ClientHub["sendMany"]>[1],
	) {
		this.hub.sendMany(targets, event);
	}

	broadcast(event: Parameters<ClientHub["broadcast"]>[0], exclude?: WsClient) {
		this.hub.broadcast(event, exclude);
	}
}

function statusSessionRef(
	status: RuntimeStatusEvent,
): ReplaySessionRef | undefined {
	return status.sessionId
		? {
				providerId: status.providerId,
				sdkSessionId: status.sessionId,
			}
		: undefined;
}

async function readReplayMessages(
	facade: Facade,
	sessionId: string,
): Promise<DisplayMessage[] | undefined> {
	const messages = facade.readReplay
		? await facade.readReplay(sessionId)
		: await facade.readHistory?.(sessionId);
	if (!messages) {
		return undefined;
	}

	const transcript = await readReplayTranscript(facade, sessionId);
	return annotateHistoryWithTranscript(messages, transcript);
}

function safeInvoke<T>(invoke: () => Promise<T> | T): Promise<T> {
	try {
		return Promise.resolve(invoke());
	} catch (err) {
		return Promise.reject(err);
	}
}

async function readReplayTranscript(
	facade: Facade,
	sessionId: string,
): Promise<TranscriptTurn[] | undefined> {
	if (!facade.readTranscript) {
		return undefined;
	}

	try {
		return await facade.readTranscript(sessionId);
	} catch {
		return undefined;
	}
}
