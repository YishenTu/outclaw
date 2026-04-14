import { createHash } from "node:crypto";

export function deriveTelegramBotId(token: string): string {
	const digest = createHash("sha256").update(token).digest("hex");
	return `bot-${digest.slice(0, 16)}`;
}
