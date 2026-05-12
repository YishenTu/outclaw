export function shortGitSha(sha: string): string {
	return sha.slice(0, 7);
}

export function gitCommitSubject(message: string): string {
	const newline = message.indexOf("\n");
	return newline === -1 ? message : message.slice(0, newline);
}
