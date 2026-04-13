import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EffortLevel,
} from "../../common/commands.ts";
import type { ModelAlias } from "../../common/models.ts";
import { resolveModelAlias } from "../../common/models.ts";

export class RuntimeSettingsState {
	private activeModel: ModelAlias = DEFAULT_MODEL;
	private activeEffort: EffortLevel = DEFAULT_EFFORT;

	get effort(): EffortLevel {
		return this.activeEffort;
	}

	get model(): ModelAlias {
		return this.activeModel;
	}

	get resolvedModel(): string {
		return resolveModelAlias(this.activeModel);
	}

	setEffort(effort: EffortLevel) {
		this.activeEffort = effort;
	}

	setModel(model: ModelAlias) {
		this.activeModel = model;
	}
}
