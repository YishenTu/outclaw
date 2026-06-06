export interface NativeCodingRepositoryLookup {
	get(id: string): { readonly rootCwd: string } | undefined;
	getByRoot(rootCwd: string): { readonly rootCwd: string } | undefined;
}

export function resolveNativeCodingStartCwd(
	repositories: NativeCodingRepositoryLookup,
	params: { target: string; cwd?: string },
): string {
	if (params.cwd !== undefined) {
		return params.cwd;
	}
	return (
		repositories.get(params.target)?.rootCwd ??
		repositories.getByRoot(params.target)?.rootCwd ??
		params.target
	);
}
