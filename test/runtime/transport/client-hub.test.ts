import { describe, expect, test } from "bun:test";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";
import { ClientHub } from "../../../src/runtime/transport/client-hub.ts";

function mockWs(
	clientType: WsClient["data"]["clientType"],
): WsClient & { events: () => unknown[] } {
	const sent: string[] = [];
	return {
		data: { clientType },
		send(payload: string) {
			sent.push(payload);
		},
		events() {
			return sent.map((item) => JSON.parse(item));
		},
	} as WsClient & { events: () => unknown[] };
}

describe("ClientHub", () => {
	test("tracks membership and filters clients by runtime surface", () => {
		const hub = new ClientHub();
		const tui = mockWs("tui");
		const browser = mockWs("browser");
		const telegram = mockWs("telegram");

		hub.add(tui);
		hub.add(browser);
		hub.add(telegram);

		expect([...hub.list()]).toEqual([tui, browser, telegram]);
		expect(hub.listByType("browser")).toEqual([browser]);
		expect(hub.listByTypes(["tui", "browser"])).toEqual([tui, browser]);
		expect(hub.listByTypes(["tui", "browser"], tui)).toEqual([browser]);

		hub.remove(browser);
		expect([...hub.list()]).toEqual([tui, telegram]);
	});

	test("serializes events for direct, many-target, and broadcast sends", () => {
		const hub = new ClientHub();
		const tui = mockWs("tui");
		const browser = mockWs("browser");
		const telegram = mockWs("telegram");
		hub.add(tui);
		hub.add(browser);
		hub.add(telegram);

		hub.send(tui, { type: "status", message: "direct" });
		hub.sendMany([browser, telegram], { type: "status", message: "many" });
		hub.broadcast({ type: "status", message: "broadcast" }, telegram);

		expect(tui.events()).toEqual([
			{ type: "status", message: "direct" },
			{ type: "status", message: "broadcast" },
		]);
		expect(browser.events()).toEqual([
			{ type: "status", message: "many" },
			{ type: "status", message: "broadcast" },
		]);
		expect(telegram.events()).toEqual([{ type: "status", message: "many" }]);
	});
});
