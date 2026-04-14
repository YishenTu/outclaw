export interface StoredAgentConfig {
	telegram?: {
		botToken?: string;
		allowedUsers?: number[] | string;
	};
}

export interface AgentConfig {
	telegram: {
		botToken: string;
		allowedUsers: number[];
	};
}

export const DEFAULT_STORED_AGENT_CONFIG: Required<StoredAgentConfig> = {
	telegram: {
		botToken: "",
		allowedUsers: [],
	},
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeStoredAgentConfig(
	raw: unknown,
): Required<StoredAgentConfig> & Record<string, unknown> {
	const document = isObject(raw) ? raw : {};
	const telegram = isObject(document.telegram) ? document.telegram : {};

	return {
		...document,
		telegram: {
			...telegram,
			botToken:
				typeof telegram.botToken === "string"
					? telegram.botToken
					: DEFAULT_STORED_AGENT_CONFIG.telegram.botToken,
			allowedUsers:
				typeof telegram.allowedUsers === "string" ||
				Array.isArray(telegram.allowedUsers)
					? telegram.allowedUsers
					: DEFAULT_STORED_AGENT_CONFIG.telegram.allowedUsers,
		},
	};
}
