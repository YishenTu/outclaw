import { describe, expect, test } from "bun:test";
import type {
	BeforeProviderRequestEvent,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import registerFastMode, {
	readOutclawServiceTier,
} from "../../../src/backend/adapters/pi/extensions/fast-mode.ts";

type SessionStartHandler = (event: SessionStartEvent) => void;
type BeforeProviderRequestHandler = (
	event: BeforeProviderRequestEvent,
	ctx: ExtensionContext,
) => unknown;

describe("Outclaw Pi fast mode extension", () => {
	test("injects priority service tier for session-scoped OpenAI GPT requests", () => {
		const handlers = registerTestFastMode();

		handlers.sessionStart({
			type: "session_start",
			reason: "startup",
			outclaw: { serviceTier: "priority" },
		} as SessionStartEvent);

		expect(
			handlers.beforeProviderRequest(
				{
					type: "before_provider_request",
					payload: { model: "gpt-5.5" },
				},
				extensionContextForModel("openai-codex", "gpt-5.5"),
			),
		).toEqual({
			model: "gpt-5.5",
			service_tier: "priority",
		});
	});

	test("does not inject fast mode without priority or a supported model", () => {
		const handlers = registerTestFastMode();

		handlers.sessionStart({
			type: "session_start",
			reason: "startup",
			outclaw: { serviceTier: "priority" },
		} as SessionStartEvent);

		expect(
			handlers.beforeProviderRequest(
				{
					type: "before_provider_request",
					payload: { model: "claude-sonnet-4-5" },
				},
				extensionContextForModel("anthropic", "claude-sonnet-4-5"),
			),
		).toBeUndefined();

		handlers.sessionStart({
			type: "session_start",
			reason: "startup",
		});

		expect(
			handlers.beforeProviderRequest(
				{
					type: "before_provider_request",
					payload: { model: "gpt-5.5" },
				},
				extensionContextForModel("openai-codex", "gpt-5.5"),
			),
		).toBeUndefined();
	});

	test("reads Outclaw service tier from custom session-start metadata", () => {
		expect(
			readOutclawServiceTier({
				type: "session_start",
				reason: "startup",
				outclaw: { serviceTier: "priority" },
			} as SessionStartEvent),
		).toBe("priority");
		expect(
			readOutclawServiceTier({
				type: "session_start",
				reason: "startup",
			}),
		).toBeUndefined();
	});
});

function registerTestFastMode() {
	let sessionStart: SessionStartHandler | undefined;
	let beforeProviderRequest: BeforeProviderRequestHandler | undefined;

	registerFastMode({
		on(event: string, handler: unknown) {
			if (event === "session_start") {
				sessionStart = handler as SessionStartHandler;
			}
			if (event === "before_provider_request") {
				beforeProviderRequest = handler as BeforeProviderRequestHandler;
			}
		},
	} as never);

	if (!sessionStart || !beforeProviderRequest) {
		throw new Error("fast mode extension did not register expected handlers");
	}
	return { sessionStart, beforeProviderRequest };
}

function extensionContextForModel(
	provider: string,
	id: string,
): ExtensionContext {
	return {
		model: { provider, id },
	} as ExtensionContext;
}
