import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EffortLevel,
} from "../../common/commands.ts";
import type { ModelAlias } from "../../common/models.ts";
import { resolveModelAlias } from "../../common/models.ts";

interface RuntimeSettingsStateOptions {
	defaultEffort?: EffortLevel;
}

export class RuntimeSettingsState {
	private readonly configuredDefaultEffort: EffortLevel;
	private activeModel: ModelAlias = DEFAULT_MODEL;
	private activeEffort: EffortLevel;

	constructor(options: RuntimeSettingsStateOptions = {}) {
		this.configuredDefaultEffort = options.defaultEffort ?? DEFAULT_EFFORT;
		this.activeEffort = this.configuredDefaultEffort;
	}

	get defaultEffort(): EffortLevel {
		return this.configuredDefaultEffort;
	}

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
