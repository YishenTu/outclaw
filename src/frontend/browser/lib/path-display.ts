export function fileNameFromPath(path: string): string {
	const normalizedPath = path.replaceAll("\\", "/").replace(/\/+$/, "");
	if (normalizedPath === "" || normalizedPath === "/dev/null") {
		return normalizedPath;
	}

	const lastSeparatorIndex = normalizedPath.lastIndexOf("/");
	return lastSeparatorIndex === -1
		? normalizedPath
		: normalizedPath.slice(lastSeparatorIndex + 1);
}
