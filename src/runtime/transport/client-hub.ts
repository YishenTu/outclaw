import { type ServerEvent, serialize } from "../../common/protocol.ts";

export type WsClient = import("bun").ServerWebSocket<Record<string, never>>;

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
