import { describe, expect, test } from "bun:test";
import { deriveTelegramBotId } from "../../src/common/telegram.ts";

describe("deriveTelegramBotId", () => {
	test("returns a stable fingerprint for a bot token", () => {
		expect(deriveTelegramBotId("123:abc")).toBe("bot-f221311c7ec8b6e8");
		expect(deriveTelegramBotId("123:abc")).toBe("bot-f221311c7ec8b6e8");
	});

	test("returns different fingerprints for different tokens", () => {
		expect(deriveTelegramBotId("123:abc")).not.toBe(
			deriveTelegramBotId("456:def"),
		);
	});
});
