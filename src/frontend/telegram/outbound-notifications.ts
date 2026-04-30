import type { TelegramMessageFileRecord } from "./files/message-file-ref.ts";
import {
	markdownToTelegramHtml,
	splitTelegramHtml,
	TELEGRAM_MESSAGE_LIMIT,
} from "./format.ts";
import type { sendTelegramHeartbeatResult } from "./messages/heartbeat-result.ts";

export interface TelegramOutboundApi {
	sendMessage(
		chatId: number,
		text: string,
		options?: object,
	): Promise<{ message_id: number }>;
	sendPhoto(
		chatId: number,
		photo: unknown,
		options?: object,
	): Promise<{ message_id: number }>;
}

export function createTelegramOutboundSender(params: {
	api: TelegramOutboundApi;
	createInputFile(path: string): unknown;
	rememberMessageFile?: (record: TelegramMessageFileRecord) => Promise<void>;
	sendHeartbeatResult: typeof sendTelegramHeartbeatResult;
}) {
	return {
		async sendCronResult(params_: {
			jobName: string;
			telegramChatId: number;
			text: string;
		}) {
			const raw = params_.text.trim()
				? `[cron] ${params_.jobName}\n${params_.text}`
				: `[cron] ${params_.jobName}`;
			const html = markdownToTelegramHtml(raw);
			const chunks = splitTelegramHtml(html || raw, TELEGRAM_MESSAGE_LIMIT);
			for (const chunk of chunks) {
				await params.api.sendMessage(params_.telegramChatId, chunk, {
					parse_mode: "HTML",
					disable_notification: true,
				});
			}
		},
		async sendHeartbeatResult(params_: {
			telegramChatId: number;
			text: string;
			images: Array<{ path: string; caption?: string }>;
		}) {
			await params.sendHeartbeatResult(
				{
					sendMessage: (chatId, text, options) =>
						params.api.sendMessage(chatId, text, options),
					sendPhoto: (chatId, path, options) =>
						params.api.sendPhoto(chatId, params.createInputFile(path), options),
				},
				{
					...params_,
					rememberMessageFile: params.rememberMessageFile,
				},
			);
		},
		async sendRolloverNotice(params_: {
			telegramChatId: number;
			text: string;
		}) {
			const html = markdownToTelegramHtml(params_.text);
			const chunks = splitTelegramHtml(
				html || params_.text,
				TELEGRAM_MESSAGE_LIMIT,
			);
			for (const chunk of chunks) {
				await params.api.sendMessage(params_.telegramChatId, chunk, {
					parse_mode: "HTML",
					disable_notification: false,
				});
			}
		},
	};
}
