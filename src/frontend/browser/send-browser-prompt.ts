import {
	canonicalizePromptSlashCommand,
	isRuntimeCommand,
} from "../../common/commands.ts";
import {
	type DisplayImage,
	extractError,
	type ImageRef,
} from "../../common/protocol.ts";
import type { ComposerImageAttachment } from "./components/chat/composer-images.ts";

interface DispatchBrowserPromptParams<SocketLike> {
	input: string;
	images?: ComposerImageAttachment[];
	getActiveAgentId: () => string | null;
	getCurrentSessionKey: (agentId: string) => string;
	getSocket: () => SocketLike | null;
	isSocketOpen: (socket: SocketLike | null) => socket is SocketLike;
	pinSession?: (sessionKey: string) => void;
	pushMessage: (
		sessionKey: string,
		message: {
			kind: "chat";
			role: "user";
			content: string;
			images?: DisplayImage[];
			timestamp?: number;
		},
	) => void;
	sendCommand: (command: string) => boolean;
	sendPrompt: (socket: SocketLike, prompt: string, images?: ImageRef[]) => void;
	setRuntimeError: (error: string | null) => void;
	setSessionError: (sessionKey: string, error: string | null) => void;
	startAssistantTurn: (sessionKey: string) => void;
	uploadImages: (files: File[]) => Promise<ImageRef[]>;
}

const CONVERSATION_CHANGED_ERROR =
	"Conversation changed while images were uploading. Please resend.";

export async function dispatchBrowserPrompt<SocketLike>(
	params: DispatchBrowserPromptParams<SocketLike>,
): Promise<boolean> {
	const images = params.images ?? [];
	const trimmed = params.input.trim();
	if (trimmed === "" && images.length === 0) {
		return false;
	}

	if (trimmed !== "" && isRuntimeCommand(trimmed)) {
		if (images.length > 0) {
			params.setRuntimeError("Runtime commands cannot include images");
			return false;
		}
		return params.sendCommand(trimmed);
	}

	const agentId = params.getActiveAgentId();
	const socket = params.getSocket();
	if (!agentId || !params.isSocketOpen(socket)) {
		params.setRuntimeError("Runtime disconnected");
		return false;
	}

	const sessionKey = params.getCurrentSessionKey(agentId);
	const prompt =
		trimmed === "" ? "" : (canonicalizePromptSlashCommand(trimmed) ?? trimmed);

	let uploadedImages: ImageRef[] | undefined;
	try {
		uploadedImages =
			images.length > 0
				? await params.uploadImages(images.map((image) => image.file))
				: undefined;
	} catch (error) {
		params.setRuntimeError(extractError(error));
		return false;
	}

	if (
		params.getActiveAgentId() !== agentId ||
		params.getCurrentSessionKey(agentId) !== sessionKey ||
		params.getSocket() !== socket ||
		!params.isSocketOpen(socket)
	) {
		params.setRuntimeError(CONVERSATION_CHANGED_ERROR);
		return false;
	}

	try {
		params.sendPrompt(socket, prompt, uploadedImages);
	} catch (error) {
		params.setRuntimeError(extractError(error));
		return false;
	}

	params.pinSession?.(sessionKey);
	params.pushMessage(sessionKey, {
		kind: "chat",
		role: "user",
		content: prompt,
		images: images.map((image) => image.image),
		timestamp: Date.now(),
	});
	params.startAssistantTurn(sessionKey);
	params.setSessionError(sessionKey, null);
	params.setRuntimeError(null);
	return true;
}
