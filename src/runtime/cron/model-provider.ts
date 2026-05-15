import { isModelAlias } from "../../common/models.ts";

export function providerIdForCronModel(model: string): string | undefined {
	if (isModelAlias(model)) {
		return "claude";
	}
	const trimmed = model.trim();
	if (trimmed.startsWith("gpt-") || trimmed.startsWith("codex")) {
		return "codex";
	}
	return undefined;
}
