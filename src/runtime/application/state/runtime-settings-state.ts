import { DEFAULT_EFFORT, type EffortLevel } from "../../../common/commands.ts";

interface RuntimeSettingsStateOptions {
	defaultEffort?: EffortLevel;
	defaultModel?: string;
}

export class RuntimeSettingsState {
	private readonly configuredDefaultEffort: EffortLevel;
	private activeModel: string;
	private activeEffort: EffortLevel;
	private activeServiceTier: string | undefined;

	constructor(options: RuntimeSettingsStateOptions = {}) {
		this.configuredDefaultEffort = options.defaultEffort ?? DEFAULT_EFFORT;
		this.activeModel = options.defaultModel ?? "";
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

	get serviceTier(): string | undefined {
		return this.activeServiceTier;
	}

	get resolvedModel(): string {
		return this.activeModel;
	}

	setEffort(effort: EffortLevel) {
		this.activeEffort = effort;
	}

	setProviderModel(model: string) {
		this.activeModel = model;
	}

	setServiceTier(serviceTier: string | undefined) {
		this.activeServiceTier = serviceTier;
	}
}
