import type {
	BeforeProviderRequestEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

const PRIORITY_SERVICE_TIER = "priority";
const OPENAI_FAST_PROVIDERS = new Set(["openai", "openai-codex"]);

interface OutclawSessionStartEvent extends SessionStartEvent {
	outclaw?: {
		serviceTier?: string;
	};
}

export default function registerFastMode(pi: ExtensionAPI) {
	let serviceTier: string | undefined;

	pi.on("session_start", (event) => {
		serviceTier = readOutclawServiceTier(event);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!shouldInjectFastServiceTier(serviceTier, event, ctx)) return;
		return { ...event.payload, service_tier: serviceTier };
	});
}

export function readOutclawServiceTier(
	event: SessionStartEvent,
): string | undefined {
	const outclaw = (event as OutclawSessionStartEvent).outclaw;
	return typeof outclaw?.serviceTier === "string"
		? outclaw.serviceTier
		: undefined;
}

export function shouldInjectFastServiceTier(
	serviceTier: string | undefined,
	event: BeforeProviderRequestEvent,
	ctx: ExtensionContext,
): event is BeforeProviderRequestEvent & { payload: Record<string, unknown> } {
	return (
		serviceTier === PRIORITY_SERVICE_TIER &&
		isOpenAiGptModel(ctx.model) &&
		isRecord(event.payload)
	);
}

function isOpenAiGptModel(model: ExtensionContext["model"]): boolean {
	return (
		model !== undefined &&
		OPENAI_FAST_PROVIDERS.has(model.provider) &&
		model.id.startsWith("gpt-")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
