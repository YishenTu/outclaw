import { describe, expect, mock, test } from "bun:test";
import { MODEL_ALIAS_LIST } from "../../../../src/common/models.ts";
import { registerTelegramModelShortcuts } from "../../../../src/frontend/telegram/commands/shortcuts.ts";

describe("Telegram model shortcuts", () => {
	test("registers one handler per alias and replies with the changed model", async () => {
		const handlers = new Map<
			string,
			(ctx: { reply(text: string): Promise<unknown> }) => Promise<void>
		>();
		const registrar = {
			command: (
				command: string,
				handler: (ctx: {
					reply(text: string): Promise<unknown>;
				}) => Promise<void>,
			) => {
				handlers.set(command, handler);
			},
		};
		const bridge = {
			sendCommandAndWait: mock(
				async (command: string, expectedTypes?: ReadonlySet<string>) => {
					expect([...(expectedTypes ?? [])]).toEqual(["model_changed"]);
					return {
						type: "model_changed",
						model: command.slice(1),
					};
				},
			),
		};

		registerTelegramModelShortcuts(registrar, () => bridge);

		expect([...handlers.keys()]).toEqual(MODEL_ALIAS_LIST);

		const reply = mock(async (_text: string) => undefined);
		await handlers.get("sonnet")?.({ reply });

		expect(bridge.sendCommandAndWait).toHaveBeenCalledWith(
			"/sonnet",
			expect.any(Set),
		);
		expect(reply).toHaveBeenCalledWith("Model: sonnet");
	});
});
