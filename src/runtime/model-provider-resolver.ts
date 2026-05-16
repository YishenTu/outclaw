import { modelAliasForModel } from "../common/models.ts";
import type { ProviderModelInfo } from "../common/protocol.ts";

export interface ModelProviderResolver {
	resolveProviderIdForModel(model: string): Promise<string | undefined>;
}

export interface ModelCatalogProvider {
	providerId: string;
	listModels?: () => Promise<ProviderModelInfo[]>;
}

export function staticModelProviderResolver(
	providerId: string,
): ModelProviderResolver {
	return {
		async resolveProviderIdForModel(model: string) {
			return model.trim() === "" ? undefined : providerId;
		},
	};
}

export function createModelProviderResolver(
	providers: readonly ModelCatalogProvider[],
): ModelProviderResolver {
	let catalogPromise: Promise<ModelCatalogEntry[]> | undefined;

	return {
		async resolveProviderIdForModel(model: string) {
			const requested = model.trim();
			if (!requested) {
				return undefined;
			}

			catalogPromise ??= loadCatalog(providers);
			const catalog = await catalogPromise;
			const matches = catalog.filter((entry) =>
				modelMatches(entry.model, requested),
			);
			const providerIds = [
				...new Set(matches.map((entry) => entry.providerId)),
			];
			if (providerIds.length === 0) {
				return undefined;
			}
			if (providerIds.length > 1) {
				throw new Error(
					`Model ${requested} resolves to multiple providers: ${providerIds.join(", ")}`,
				);
			}
			return providerIds[0];
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

function modelMatches(entry: ProviderModelInfo, requested: string): boolean {
	if (entry.model === requested || entry.id === requested) {
		return true;
	}

	const requestedAlias = modelAliasForModel(requested);
	if (!requestedAlias) {
		return false;
	}
	return entry.model === requestedAlias || entry.id === requestedAlias;
}
