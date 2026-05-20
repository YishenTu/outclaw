export interface ProviderSessionRef {
	providerId: string;
	sdkSessionId: string;
}

export interface MaybeProviderSessionRef {
	providerId?: string;
	sdkSessionId: string;
}

export function providerSessionRefKey(ref: ProviderSessionRef): string {
	return `${ref.providerId}\u0000${ref.sdkSessionId}`;
}

export function formatProviderSessionRef(ref: ProviderSessionRef): string {
	return `${ref.providerId}/${ref.sdkSessionId}`;
}

export function formatMaybeProviderSessionRef(
	ref: MaybeProviderSessionRef,
): string {
	return ref.providerId
		? formatProviderSessionRef({
				providerId: ref.providerId,
				sdkSessionId: ref.sdkSessionId,
			})
		: ref.sdkSessionId;
}

export function providerSessionRefsEqual(
	left: ProviderSessionRef,
	right: ProviderSessionRef,
): boolean {
	return (
		left.providerId === right.providerId &&
		left.sdkSessionId === right.sdkSessionId
	);
}
