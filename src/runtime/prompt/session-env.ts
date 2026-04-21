/**
 * Build the session-scoped environment variables outclaw injects into an
 * agent run. These are inherited by the agent process and its Bash-tool
 * subprocesses, so CLI tools like `oc note` can resolve their session
 * without any IPC.
 *
 * The caller owns the session id so identity stays stable across resumed
 * runs in one conversation — the outclaw runtime tracks session id at a
 * higher layer and threads it down per run.
 */
export function buildSessionEnv(
	promptHomeDir: string | undefined,
	sessionId: string,
): Record<string, string> | undefined {
	if (!promptHomeDir) return undefined;
	return {
		OC_SESSION_ID: sessionId,
		OC_MEMORY_ROOT: promptHomeDir,
	};
}
