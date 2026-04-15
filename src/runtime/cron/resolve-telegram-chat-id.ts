interface CronTelegramConfig {
	allowedUsers: number[];
	defaultCronUserId?: number;
}

interface CronTargetJobConfig {
	name: string;
	telegramUserId?: number;
}

export function createCronTelegramChatIdResolver(config: CronTelegramConfig) {
	return (job: CronTargetJobConfig): number | undefined => {
		const selectedUserId =
			job.telegramUserId ??
			config.defaultCronUserId ??
			(config.allowedUsers.length === 1 ? config.allowedUsers[0] : undefined);

		if (selectedUserId === undefined) {
			return undefined;
		}

		if (!config.allowedUsers.includes(selectedUserId)) {
			if (job.telegramUserId !== undefined) {
				throw new Error(
					`Cron job "${job.name}" telegramUserId ${selectedUserId} is not in allowedUsers`,
				);
			}
			throw new Error(
				`Agent defaultCronUserId ${selectedUserId} is not in allowedUsers`,
			);
		}

		// Cron delivery is private-chat only, so the target chat id matches the
		// Telegram user id.
		return selectedUserId;
	};
}
