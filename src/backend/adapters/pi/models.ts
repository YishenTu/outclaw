import type { ProviderModelInfo } from "../../../common/protocol.ts";
import type { PiDriverModel } from "./types.ts";

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
		serviceTiers: model.serviceTiers ?? [],
	}));
}
