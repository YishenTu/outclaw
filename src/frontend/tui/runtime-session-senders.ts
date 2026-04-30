import { canonicalizePromptSlashCommand } from "../../common/commands.ts";
import { extractError } from "../../common/protocol.ts";
import {
	isRuntimeSocketOpen,
	sendRequestSkills,
	sendRuntimeCommand,
	sendRuntimePrompt,
} from "../runtime-client/index.ts";
import { applyAction } from "./transcript/reducer.ts";
import type { TuiState } from "./transcript/state.ts";

export function sendWithOpenTuiSocket(params: {
	pushLocalMessage(role: "error" | "info", text: string): void;
	send(ws: WebSocket): void;
	ws: WebSocket | null;
}): boolean {
	if (!isRuntimeSocketOpen(params.ws)) {
		params.pushLocalMessage(
			"error",
			"Runtime disconnected. Waiting to reconnect.",
		);
		return false;
	}

	try {
		params.send(params.ws);
		return true;
	} catch (error) {
		params.pushLocalMessage("error", extractError(error));
		return false;
	}
}

export function sendTuiRuntimeCommand(params: {
	command: string;
	pushLocalMessage(role: "error" | "info", text: string): void;
	ws: WebSocket | null;
}): boolean {
	return sendWithOpenTuiSocket({
		pushLocalMessage: params.pushLocalMessage,
		send: (ws) => sendRuntimeCommand(ws, params.command),
		ws: params.ws,
	});
}

export function sendTuiRuntimePrompt(params: {
	prompt: string;
	pushLocalMessage(role: "error" | "info", text: string): void;
	ws: WebSocket | null;
}): boolean {
	return sendWithOpenTuiSocket({
		pushLocalMessage: params.pushLocalMessage,
		send: (ws) => sendRuntimePrompt(ws, params.prompt),
		ws: params.ws,
	});
}

export function applyOptimisticPromptState(
	previous: TuiState,
	prompt: string,
): TuiState {
	const compacting = canonicalizePromptSlashCommand(prompt) === "/compact";
	const withPrompt = applyAction(previous, {
		type: "push",
		role: "user",
		text: prompt,
	});
	const withCompacting = compacting
		? applyAction(withPrompt, { type: "start_compacting" })
		: withPrompt;
	return {
		...withCompacting,
		running: true,
		compacting: compacting || withCompacting.compacting,
	};
}

export function requestTuiSkillsOnce(params: {
	alreadyRequested: boolean;
	ws: WebSocket | null;
}): boolean {
	if (params.alreadyRequested || !isRuntimeSocketOpen(params.ws)) {
		return false;
	}

	try {
		sendRequestSkills(params.ws);
		return true;
	} catch {
		return false;
	}
}
