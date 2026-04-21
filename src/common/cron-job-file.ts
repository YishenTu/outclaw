function getPathLeaf(path: string): string {
	const normalizedPath = path.replaceAll("\\", "/");
	const lastSeparatorIndex = normalizedPath.lastIndexOf("/");
	if (lastSeparatorIndex === -1) {
		return normalizedPath;
	}
	return normalizedPath.slice(lastSeparatorIndex + 1);
}

export function hasCronJobExtension(path: string): boolean {
	const filename = getPathLeaf(path);
	return filename.endsWith(".yaml") || filename.endsWith(".yml");
}

export function isCronJobFile(path: string): boolean {
	const filename = getPathLeaf(path);
	return !filename.startsWith("_") && hasCronJobExtension(filename);
}
