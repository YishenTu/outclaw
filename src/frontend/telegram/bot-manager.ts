import { startTelegramBot, type TelegramBotOptions } from "./bot.ts";
import type {
	TelegramMessageFile,
	TelegramMessageFileRecord,
} from "./files/message-file-ref.ts";

export interface TelegramBotManagerAgent {
	agentId: string;
	allowedUsers: number[];
	botToken: string;
}

export interface TelegramBotFileBindings {
	close(): void;
	rememberMessageFile(record: TelegramMessageFileRecord): Promise<void>;
	resolveMessageFile(
		chatId: number,
		messageId: number,
	): Promise<TelegramMessageFile | undefined>;
}

interface TelegramBotManagerOptions {
	agents: TelegramBotManagerAgent[];
	createBotId?: (token: string) => string;
	createFileBindings: (botId: string) => TelegramBotFileBindings;
	filesRoot: string;
	logWarning?: (message: string) => void;
	runtimeUrl: string;
	startBot?: (
		options: TelegramBotOptions,
	) => ReturnType<typeof startTelegramBot>;
}

interface StartedBot {
	bindings: TelegramBotFileBindings;
	service: ReturnType<typeof startTelegramBot>;
}

const DEFAULT_LOG_WARNING = (message: string) => console.warn(message);

export function createTelegramBotManager(options: TelegramBotManagerOptions) {
	const createBotId =
		options.createBotId ??
		((token: string) => {
			throw new Error(`Missing createBotId for Telegram token ${token}`);
		});
	const startBot = options.startBot ?? startTelegramBot;
	const logWarning = options.logWarning ?? DEFAULT_LOG_WARNING;
	const botIdByAgentId = new Map<string, string>();
	const startedBots = new Map<string, StartedBot>();

	for (const group of groupAgentsByToken(options.agents)) {
		const botId = createBotId(group.token);
		for (const agent of group.agents) {
			botIdByAgentId.set(agent.agentId, botId);
		}

		if (group.allowedUsers.length === 0) {
			logWarning(
				`Telegram bot ${botId} has no allowed users. Bot will not start.`,
			);
			continue;
		}

		const bindings = options.createFileBindings(botId);
		const service = startBot({
			botId,
			token: group.token,
			runtimeUrl: options.runtimeUrl,
			allowedUsers: group.allowedUsers,
			filesRoot: options.filesRoot,
			resolveMessageFile: bindings.resolveMessageFile,
			rememberMessageFile: bindings.rememberMessageFile,
		});
		startedBots.set(botId, {
			bindings,
			service,
		});
	}

	return {
		getBotId(agentId: string) {
			return botIdByAgentId.get(agentId);
		},
		async sendCronResult(
			agentId: string,
			params: Parameters<
				ReturnType<typeof startTelegramBot>["sendCronResult"]
			>[0],
		) {
			const bot = getStartedBot(startedBots, botIdByAgentId.get(agentId));
			if (!bot) {
				return;
			}
			await bot.service.sendCronResult(params);
		},
		async sendHeartbeatResult(
			agentId: string,
			params: Parameters<
				ReturnType<typeof startTelegramBot>["sendHeartbeatResult"]
			>[0],
		) {
			const bot = getStartedBot(startedBots, botIdByAgentId.get(agentId));
			if (!bot) {
				return;
			}
			await bot.service.sendHeartbeatResult(params);
		},
		stop() {
			for (const { bindings, service } of startedBots.values()) {
				service.stop();
				bindings.close();
			}
		},
	};
}

function getStartedBot(
	startedBots: Map<string, StartedBot>,
	botId: string | undefined,
) {
	if (!botId) {
		return undefined;
	}
	return startedBots.get(botId);
}

function groupAgentsByToken(agents: TelegramBotManagerAgent[]) {
	const groups = new Map<
		string,
		{
			agents: TelegramBotManagerAgent[];
			allowedUsers: number[];
			token: string;
		}
	>();

	for (const agent of agents) {
		if (!agent.botToken) {
			continue;
		}

		const existing = groups.get(agent.botToken);
		if (existing) {
			existing.agents.push(agent);
			existing.allowedUsers = mergeAllowedUsers(
				existing.allowedUsers,
				agent.allowedUsers,
			);
			continue;
		}

		groups.set(agent.botToken, {
			agents: [agent],
			allowedUsers: mergeAllowedUsers([], agent.allowedUsers),
			token: agent.botToken,
		});
	}

	return [...groups.values()].sort((left, right) =>
		left.token.localeCompare(right.token),
	);
}

function mergeAllowedUsers(current: number[], next: number[]) {
	return [...new Set([...current, ...next])].sort(
		(left, right) => left - right,
	);
}
