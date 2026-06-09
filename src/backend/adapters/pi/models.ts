import type { ProviderModelInfo } from "../../../common/protocol.ts";
import type { PiDriverModel } from "./types.ts";

export const DEFAULT_PI_CHAT_MODEL = "openai-codex/gpt-5.5";
export const PI_FAST_SERVICE_TIER = {
	id: "priority",
	name: "Fast",
	description: "Priority service tier for supported OpenAI GPT models.",
};

export function projectPiModels(models: PiDriverModel[]): ProviderModelInfo[] {
	return models.map((model) => ({
		id: model.id,
		model: model.model ?? model.id,
		displayName: model.displayName ?? model.id,
		description: model.description ?? "",
		isDefault: model.isDefault ?? false,
		defaultReasoningEffort: model.defaultReasoningEffort ?? "medium",
		supportedReasoningEfforts: model.supportedReasoningEfforts ?? [
			model.defaultReasoningEffort ?? "medium",
		],
		...(model.contextWindow !== undefined
			? { contextWindow: model.contextWindow }
			: {}),
		serviceTiers: model.serviceTiers ?? serviceTiersForPiModel(model),
	}));
}

function serviceTiersForPiModel(
	model: Pick<PiDriverModel, "id" | "model">,
): ProviderModelInfo["serviceTiers"] {
	return isOpenAiGptPiModel(model.model ?? model.id)
		? [PI_FAST_SERVICE_TIER]
		: [];
}

export function isOpenAiGptPiModel(modelId: string): boolean {
	const slash = modelId.indexOf("/");
	if (slash <= 0 || slash === modelId.length - 1) return false;
	const provider = modelId.slice(0, slash);
	const id = modelId.slice(slash + 1);
	return (
		(provider === "openai" || provider === "openai-codex") &&
		id.startsWith("gpt-")
	);
}
