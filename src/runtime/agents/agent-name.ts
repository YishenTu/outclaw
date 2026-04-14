const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertValidAgentName(name: string) {
	if (!AGENT_NAME_PATTERN.test(name)) {
		throw new Error(`Invalid agent name: ${name}`);
	}
}
