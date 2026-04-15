export interface StoredAgentConfig {
	telegram?: {
		botToken?: string;
		allowedUsers?: number[] | string;
		defaultCronUserId?: number | string;
	};
}

export interface AgentConfig {
	telegram: {
		botToken: string;
		allowedUsers: number[];
		defaultCronUserId?: number;
	};
}

export const DEFAULT_STORED_AGENT_CONFIG: StoredAgentConfig = {
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
): StoredAgentConfig & Record<string, unknown> {
	const document = isObject(raw) ? raw : {};
	const telegram = isObject(document.telegram) ? document.telegram : {};

	return {
		...document,
		telegram: {
			...telegram,
			botToken:
				typeof telegram.botToken === "string"
					? telegram.botToken
					: (DEFAULT_STORED_AGENT_CONFIG.telegram?.botToken ?? ""),
			allowedUsers:
				typeof telegram.allowedUsers === "string" ||
				Array.isArray(telegram.allowedUsers)
					? telegram.allowedUsers
					: (DEFAULT_STORED_AGENT_CONFIG.telegram?.allowedUsers ?? []),
			...(typeof telegram.defaultCronUserId === "string" ||
			typeof telegram.defaultCronUserId === "number"
				? {
						defaultCronUserId: telegram.defaultCronUserId,
					}
				: {}),
		},
	};
}

export function assertDefaultCronUserAllowed(
	allowedUsers: number[],
	defaultCronUserId?: number,
) {
	if (
		defaultCronUserId !== undefined &&
		!allowedUsers.includes(defaultCronUserId)
	) {
		throw new Error(
			`Default cron user ${defaultCronUserId} must be included in allowed users`,
		);
	}
}
