export const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function getAgentNameValidationError(name: string): string | undefined {
	if (AGENT_NAME_PATTERN.test(name)) {
		return undefined;
	}

	return "use lowercase letters, digits, and single hyphens only";
}

export function assertValidAgentName(name: string) {
	if (getAgentNameValidationError(name) === undefined) {
		return;
	}

	throw new Error(`Invalid agent name: ${name}`);
}
