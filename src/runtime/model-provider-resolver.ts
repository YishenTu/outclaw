import { DEFAULT_EFFORT } from "../common/commands.ts";
import type { ProviderModelInfo } from "../common/protocol.ts";

export interface ModelProviderResolver {
	resolveProviderIdForModel(model: string): Promise<string | undefined>;
	resolveModelSelection(
		model: string,
	): Promise<ResolvedProviderModel | undefined>;
	listModelSelections(): Promise<ResolvedProviderModel[]>;
}

export interface ModelCatalogProvider {
	providerId: string;
	listModels?: () => Promise<ProviderModelInfo[]>;
}

export interface ResolvedProviderModel {
	providerId: string;
	model: ProviderModelInfo;
}

export function staticModelProviderResolver(
	providerId: string,
): ModelProviderResolver {
	return {
		async resolveProviderIdForModel(model: string) {
			return model.trim() === "" ? undefined : providerId;
		},
		async resolveModelSelection(model: string) {
			const requested = model.trim();
			if (!requested) {
				return undefined;
			}
			return {
				providerId,
				model: genericProviderModelInfo(requested),
			};
		},
		async listModelSelections() {
			return [];
		},
	};
}

export function createModelProviderResolver(
	providers: readonly ModelCatalogProvider[],
): ModelProviderResolver {
	let catalogPromise: Promise<ModelCatalogEntry[]> | undefined;

	return {
		async resolveProviderIdForModel(model: string) {
			return (await this.resolveModelSelection(model))?.providerId;
		},
		async resolveModelSelection(model: string) {
			const requested = model.trim();
			if (!requested) {
				return undefined;
			}

			catalogPromise ??= loadCatalog(providers);
			const catalog = await catalogPromise;
			const exactMatches = catalog.filter((entry) =>
				modelMatches(entry.model, requested),
			);
			if (exactMatches.length > 0) {
				return selectUniqueModel(requested, exactMatches);
			}

			const providerIds = new Set(catalog.map((entry) => entry.providerId));
			const providerQualified = parseProviderQualifiedModel(
				requested,
				providerIds,
			);
			const matches = catalog.filter((entry) => {
				if (
					providerQualified &&
					entry.providerId !== providerQualified.providerId
				) {
					return false;
				}
				return modelMatches(entry.model, providerQualified?.model ?? requested);
			});
			return selectUniqueModel(requested, matches);
		},
		async listModelSelections() {
			catalogPromise ??= loadCatalog(providers);
			return await catalogPromise;
		},
	};
}

interface ModelCatalogEntry {
	providerId: string;
	model: ProviderModelInfo;
}

async function loadCatalog(
	providers: readonly ModelCatalogProvider[],
): Promise<ModelCatalogEntry[]> {
	const catalogs = await Promise.all(
		providers.map(async (provider) => {
			const models = provider.listModels ? await provider.listModels() : [];
			return models.map((model) => ({
				providerId: provider.providerId,
				model,
			}));
		}),
	);
	return catalogs.flat();
}

function selectUniqueModel(
	requested: string,
	matches: ModelCatalogEntry[],
): ResolvedProviderModel | undefined {
	if (matches.length === 0) {
		return undefined;
	}
	const providerIds = [...new Set(matches.map((entry) => entry.providerId))];
	if (providerIds.length > 1) {
		throw new Error(
			`Model ${requested} resolves to multiple providers: ${providerIds.join(", ")}`,
		);
	}
	const selected = matches[0];
	return selected
		? { providerId: selected.providerId, model: selected.model }
		: undefined;
}

function modelMatches(entry: ProviderModelInfo, requested: string): boolean {
	return entry.model === requested || entry.id === requested;
}

function parseProviderQualifiedModel(
	value: string,
	configuredProviderIds: ReadonlySet<string>,
): { providerId: string; model: string } | undefined {
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) {
		return undefined;
	}
	const providerId = value.slice(0, separator);
	if (!configuredProviderIds.has(providerId)) {
		return undefined;
	}

	return {
		providerId,
		model: value.slice(separator + 1),
	};
}

function genericProviderModelInfo(model: string): ProviderModelInfo {
	return {
		id: model,
		model,
		displayName: model,
		description: "",
		isDefault: false,
		defaultReasoningEffort: DEFAULT_EFFORT,
		supportedReasoningEfforts: [],
		serviceTiers: [],
	};
}
