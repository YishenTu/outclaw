import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	type EffortLevel,
} from "../../../common/commands.ts";
import type { ModelAlias } from "../../../common/models.ts";
import { resolveModelAlias } from "../../../common/models.ts";

interface RuntimeSettingsStateOptions {
	defaultEffort?: EffortLevel;
}

export class RuntimeSettingsState {
	private readonly configuredDefaultEffort: EffortLevel;
	private activeModel: string = DEFAULT_MODEL;
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

	get model(): string {
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

	/**
	 * Set the provider-local model id directly. Use this for non-Claude
	 * providers whose model ids don't fit the `ModelAlias` registry. Claude
	 * paths should keep calling `setModel(alias)`.
	 */
	setProviderModel(model: string) {
		this.activeModel = model;
	}
}
