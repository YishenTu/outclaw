import { MODEL_ALIAS_LIST } from "../../../common/models.ts";
import type { TelegramRuntimeCommandBridge } from "./runtime.ts";

interface TelegramModelShortcutContext {
	from?: { id: number };
	reply(text: string): Promise<unknown>;
}

interface TelegramModelShortcutRegistrar {
	command(
		command: string,
		handler: (ctx: TelegramModelShortcutContext) => Promise<void>,
	): unknown;
}

type TelegramModelShortcutBridgeFactory = (
	ctx: TelegramModelShortcutContext,
) => TelegramRuntimeCommandBridge;

export function registerTelegramModelShortcuts(
	registrar: TelegramModelShortcutRegistrar,
	createBridge: TelegramModelShortcutBridgeFactory,
) {
	const expectedTypes = new Set(["model_changed"]);

	for (const alias of MODEL_ALIAS_LIST) {
		registrar.command(alias, async (ctx) => {
			const bridge = createBridge(ctx);
			const event = await bridge.sendCommandAndWait(`/${alias}`, expectedTypes);
			if (event.type === "model_changed") {
				await ctx.reply(`Model: ${String(event.model)}`);
			}
		});
	}
}
