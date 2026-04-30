import { extractError } from "../../common/protocol.ts";

export function createPrivateChatMiddleware(params: {
	leaveChat(chatId: number): Promise<unknown>;
	logError(message: string): void;
}) {
	return async (
		ctx: {
			chat?: { id: number; type: string };
		},
		next: () => Promise<unknown>,
	) => {
		if (ctx.chat && ctx.chat.type !== "private") {
			try {
				await params.leaveChat(ctx.chat.id);
			} catch (err) {
				params.logError(
					`Failed to leave non-private Telegram chat ${ctx.chat.id}: ${extractError(err)}`,
				);
			}
			return;
		}
		return next();
	};
}

export function createAllowedUsersMiddleware(allowedUsers: number[]) {
	const allowed = new Set(allowedUsers);
	return async (
		ctx: {
			from?: { id: number };
			message?: { text?: string };
		},
		next: () => Promise<unknown>,
	) => {
		if (ctx.message?.text?.trim() === "/start") {
			return next();
		}
		if (ctx.from && allowed.has(ctx.from.id)) {
			return next();
		}
	};
}
