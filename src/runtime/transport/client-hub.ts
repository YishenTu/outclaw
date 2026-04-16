import {
	type RuntimeClientType,
	type ServerEvent,
	serialize,
} from "../../common/protocol.ts";

export interface RuntimeClientData {
	clientType: RuntimeClientType;
	requestedAgentName?: string;
	telegramBotId?: string;
	telegramUserId?: number;
}

export type WsClient = import("bun").ServerWebSocket<RuntimeClientData>;

export class ClientHub {
	private clients = new Set<WsClient>();

	add(client: WsClient) {
		this.clients.add(client);
	}

	remove(client: WsClient) {
		this.clients.delete(client);
	}

	list(): Iterable<WsClient> {
		return this.clients;
	}

	listByType(type: RuntimeClientType, exclude?: WsClient): WsClient[] {
		return [...this.clients].filter(
			(client) => client !== exclude && client.data.clientType === type,
		);
	}

	listByTypes(types: RuntimeClientType[], exclude?: WsClient): WsClient[] {
		const allowedTypes = new Set(types);
		return [...this.clients].filter(
			(client) =>
				client !== exclude && allowedTypes.has(client.data.clientType),
		);
	}

	send(client: WsClient, event: ServerEvent) {
		client.send(serialize(event));
	}

	sendMany(clients: Iterable<WsClient>, event: ServerEvent) {
		const serialized = serialize(event);
		for (const client of clients) {
			client.send(serialized);
		}
	}

	broadcast(event: ServerEvent, exclude?: WsClient) {
		const serialized = serialize(event);
		for (const client of this.clients) {
			if (client !== exclude) {
				client.send(serialized);
			}
		}
	}
}
