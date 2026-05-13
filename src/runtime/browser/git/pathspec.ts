export function gitExcludePathspecsForPaths(
	paths: readonly string[],
): string[] {
	return paths.flatMap((path) => gitExcludePathspecsForPath(path));
}

function gitExcludePathspecsForPath(path: string): string[] {
	const escapedPath = escapeGitGlobPathspec(path);
	const pathspecs = [
		`:(exclude,literal)${path}`,
		`:(glob,exclude)${escapedPath}/**`,
	];
	if (!path.includes("/")) {
		pathspecs.push(
			`:(glob,exclude)**/${escapedPath}`,
			`:(glob,exclude)**/${escapedPath}/**`,
		);
	}
	return pathspecs;
}

function escapeGitGlobPathspec(path: string): string {
	return path.replace(/[\\[\]*?]/g, "\\$&");
}
