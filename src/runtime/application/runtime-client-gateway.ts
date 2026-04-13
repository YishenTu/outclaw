import type { Facade, RuntimeStatusEvent } from "../../common/protocol.ts";
import { extractError } from "../../common/protocol.ts";
import { ClientHub, type WsClient } from "../transport/client-hub.ts";

interface RuntimeClientGatewayOptions {
	cwd?: string;
	facade: Facade;
	getStatusEvent: () => RuntimeStatusEvent;
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

	listTuiTargets(exclude?: WsClient): WsClient[] {
		return this.hub.listByType("tui", exclude);
	}

	replayHistory(
		targets: Iterable<WsClient>,
		sessionId = this.options.getStatusEvent().sessionId,
	) {
		const targetList = [...targets];
		if (!sessionId || !this.options.facade.readHistory) {
			return Promise.resolve();
		}

		return safeInvoke(() => this.options.facade.readHistory?.(sessionId))
			.then((messages) => {
				if (!messages) {
					return;
				}
				this.hub.sendMany(targetList, {
					type: "history_replay",
					messages,
				});
			})
			.catch((error) => {
				this.hub.sendMany(targetList, {
					type: "error",
					message: `Failed to replay history: ${extractError(error)}`,
				});
			});
	}

	requestSkills(ws: WsClient) {
		if (!this.options.facade.getSkills) {
			return;
		}

		void safeInvoke(() => this.options.facade.getSkills?.(this.options.cwd))
			.then((skills) => {
				if (!skills) {
					return;
				}
				this.hub.send(ws, { type: "skills_update", skills });
			})
			.catch((err) => {
				this.hub.send(ws, {
					type: "error",
					message: extractError(err),
				});
			});
	}

	send(ws: WsClient, event: Parameters<ClientHub["send"]>[1]) {
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

function safeInvoke<T>(invoke: () => Promise<T> | T): Promise<T> {
	try {
		return Promise.resolve(invoke());
	} catch (err) {
		return Promise.reject(err);
	}
}
