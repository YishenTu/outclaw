export function agentEnvNamePrefix(name: string): string {
	return name
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export function agentTelegramBotTokenEnvKey(name: string): string {
	return `${agentEnvNamePrefix(name)}_TELEGRAM_BOT_TOKEN`;
}

export function agentTelegramUsersEnvKey(name: string): string {
	return `${agentEnvNamePrefix(name)}_TELEGRAM_USERS`;
}
