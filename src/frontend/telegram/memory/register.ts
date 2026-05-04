import { InlineKeyboard } from "grammy";
import type { BotCommand } from "grammy/types";
import type {
	MemoryFileCommandName,
	MemoryFileContentEvent,
	MemoryFileMenuEvent,
} from "../../../common/protocol.ts";
import {
	markdownToTelegramHtml,
	splitTelegramVisibleHtml,
	TELEGRAM_MESSAGE_LIMIT,
} from "../format.ts";

interface TelegramMemoryCommandEvent {
	type: string;
	[key: string]: unknown;
}

interface TelegramMemoryBridge {
	sendCommandAndWait(
		command: string,
		expectedTypes?: ReadonlySet<string>,
	): Promise<TelegramMemoryCommandEvent>;
}

interface TelegramMemoryCommandContext {
	from?: { id: number };
	match?: string;
	message?: { text?: string };
	reply(
		text: string,
		options?: {
			disable_notification?: boolean;
			parse_mode?: "HTML";
			reply_markup?: InlineKeyboard;
		},
	): Promise<unknown>;
}

interface TelegramMemoryCallbackContext {
	callbackQuery: { data: string };
	from?: { id: number };
	answerCallbackQuery(text: string): Promise<unknown>;
	reply(
		text: string,
		options?: {
			disable_notification?: boolean;
			parse_mode?: "HTML";
		},
	): Promise<unknown>;
}

interface TelegramMemoryRegistrar {
	command(
		command: string,
		handler: (ctx: TelegramMemoryCommandContext) => Promise<void>,
	): unknown;
	callbackQuery(
		pattern: RegExp,
		handler: (ctx: TelegramMemoryCallbackContext) => Promise<void>,
	): unknown;
}

type TelegramMemoryBridgeFactory = (
	ctx: TelegramMemoryCommandContext | TelegramMemoryCallbackContext,
) => TelegramMemoryBridge;

interface TelegramMemoryCommandDefinition {
	callbackKey: string;
	description: string;
	runtimeCommand: MemoryFileCommandName;
	telegramCommand: string;
}

const MEMORY_COMMANDS: TelegramMemoryCommandDefinition[] = [
	{
		callbackKey: "n",
		description: "Show note files",
		runtimeCommand: "notes",
		telegramCommand: "notes",
	},
	{
		callbackKey: "s",
		description: "Show schema files",
		runtimeCommand: "schema",
		telegramCommand: "schema",
	},
	{
		callbackKey: "d",
		description: "Show daily memory files",
		runtimeCommand: "daily-memories",
		telegramCommand: "daily_memories",
	},
	{
		callbackKey: "w",
		description: "Show working memory files",
		runtimeCommand: "working-files",
		telegramCommand: "working_files",
	},
];

const COMMANDS_BY_TELEGRAM_NAME = new Map(
	MEMORY_COMMANDS.flatMap((command) => [
		[command.telegramCommand, command],
		[command.runtimeCommand, command],
	]),
);

const COMMANDS_BY_CALLBACK_KEY = new Map(
	MEMORY_COMMANDS.map((command) => [command.callbackKey, command]),
);

export const TELEGRAM_MEMORY_COMMANDS: BotCommand[] = MEMORY_COMMANDS.map(
	(command) => ({
		command: command.telegramCommand,
		description: command.description,
	}),
);

export function registerTelegramMemoryHandlers(
	registrar: TelegramMemoryRegistrar,
	createBridge: TelegramMemoryBridgeFactory,
) {
	for (const command of MEMORY_COMMANDS) {
		registrar.command(command.telegramCommand, async (ctx) => {
			await handleMemoryCommand(ctx, createBridge(ctx), command, ctx.match);
		});
	}

	registrar.callbackQuery(/^mf:/, async (ctx) => {
		const action = parseMemoryCallback(ctx.callbackQuery.data);
		if (!action) {
			await ctx.answerCallbackQuery("Invalid memory file selection");
			return;
		}

		const event = await createBridge(ctx).sendCommandAndWait(
			`/${action.command.runtimeCommand} ${action.fileId}`,
			new Set(["memory_file_content"]),
		);
		if (event.type !== "memory_file_content") {
			await ctx.answerCallbackQuery(
				formatError(event) ?? String(event.message ?? "Error"),
			);
			return;
		}

		const content = event as unknown as MemoryFileContentEvent;
		await ctx.answerCallbackQuery(`Opened ${content.path}`);
		await sendMemoryFileContent(ctx, content);
	});
}

export async function handleTelegramMemoryTextCommand(
	ctx: TelegramMemoryCommandContext,
	createBridge: TelegramMemoryBridgeFactory,
): Promise<boolean> {
	const parsed = parseMemoryTextCommand(ctx.message?.text ?? "");
	if (!parsed) {
		return false;
	}

	await handleMemoryCommand(
		ctx,
		createBridge(ctx),
		parsed.command,
		parsed.selector,
	);
	return true;
}

async function handleMemoryCommand(
	ctx: TelegramMemoryCommandContext,
	bridge: TelegramMemoryBridge,
	command: TelegramMemoryCommandDefinition,
	selector?: string,
) {
	const trimmedSelector = selector?.trim();
	const request = trimmedSelector
		? `/${command.runtimeCommand} ${trimmedSelector}`
		: `/${command.runtimeCommand}`;
	const expectedTypes = new Set<string>([
		trimmedSelector ? "memory_file_content" : "memory_file_menu",
	]);
	const event = await bridge.sendCommandAndWait(request, expectedTypes);

	if (event.type === "memory_file_menu") {
		await sendMemoryFileMenu(ctx, event as unknown as MemoryFileMenuEvent);
		return;
	}

	if (event.type === "memory_file_content") {
		await sendMemoryFileContent(
			ctx,
			event as unknown as MemoryFileContentEvent,
		);
		return;
	}

	const reply = formatError(event);
	if (reply) {
		await ctx.reply(reply);
	}
}

async function sendMemoryFileMenu(
	ctx: TelegramMemoryCommandContext,
	event: MemoryFileMenuEvent,
) {
	if (event.files.length === 0) {
		const root =
			event.rootPath === "." ? "working files" : `${event.rootPath}/`;
		await ctx.reply(`No files in ${root}`);
		return;
	}

	const command = MEMORY_COMMANDS.find(
		(candidate) => candidate.runtimeCommand === event.command,
	);
	if (!command) {
		await ctx.reply(`[error] Unknown memory file command: ${event.command}`);
		return;
	}

	const keyboard = new InlineKeyboard();
	for (const file of event.files) {
		keyboard.text(file.name, `mf:${command.callbackKey}:${file.id}`).row();
	}

	await ctx.reply(`${event.title}:`, { reply_markup: keyboard });
}

async function sendMemoryFileContent(
	ctx: Pick<TelegramMemoryCommandContext, "reply">,
	event: MemoryFileContentEvent,
) {
	const markdown =
		event.command === "working-files"
			? event.content
			: `# ${event.path}\n\n${event.content}`;
	const html = markdownToTelegramHtml(markdown);
	const chunks = splitTelegramVisibleHtml(
		html || markdown,
		TELEGRAM_MESSAGE_LIMIT,
	);
	for (const chunk of chunks) {
		await ctx.reply(chunk, {
			parse_mode: "HTML",
			disable_notification: true,
		});
	}
}

function parseMemoryCallback(data: string):
	| {
			command: TelegramMemoryCommandDefinition;
			fileId: string;
	  }
	| undefined {
	const [, key, fileId] = /^mf:([^:]+):(.+)$/.exec(data) ?? [];
	if (!key || !fileId) {
		return undefined;
	}

	const command = COMMANDS_BY_CALLBACK_KEY.get(key);
	if (!command) {
		return undefined;
	}

	return { command, fileId };
}

function parseMemoryTextCommand(text: string):
	| {
			command: TelegramMemoryCommandDefinition;
			selector: string;
	  }
	| undefined {
	const trimmed = text.trim();
	const match = /^\/([A-Za-z0-9_-]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(
		trimmed,
	);
	if (!match) {
		return undefined;
	}

	const command = COMMANDS_BY_TELEGRAM_NAME.get(match[1] ?? "");
	if (!command) {
		return undefined;
	}

	return {
		command,
		selector: (match[2] ?? "").trim(),
	};
}

function formatError(event: TelegramMemoryCommandEvent): string | undefined {
	return event.type === "error"
		? `[error] ${String(event.message ?? "")}`
		: undefined;
}
