import {
	type DisplayChatMessage,
	extractError,
	type ImageRef,
} from "../../../common/protocol.ts";
import type { ComposerImageAttachment } from "../attachments/composer-images.ts";
import { applyOptimisticBrowserPrompt } from "./optimistic-browser-prompt.ts";
import { preparePromptDispatch } from "./prepare-prompt-dispatch.ts";

interface DispatchBrowserPromptParams<SocketLike> {
	input: string;
	images?: ComposerImageAttachment[];
	getActiveAgentId: () => string | null;
	getCurrentSessionKey: (agentId: string) => string;
	getSocket: () => SocketLike | null;
	isSocketOpen: (socket: SocketLike | null) => socket is SocketLike;
	pinSession?: (sessionKey: string) => void;
	pushMessage: (sessionKey: string, message: DisplayChatMessage) => void;
	queueMessage: (sessionKey: string, message: DisplayChatMessage) => void;
	sendCommand: (command: string) => boolean;
	sendPrompt: (socket: SocketLike, prompt: string, images?: ImageRef[]) => void;
	setRuntimeError: (error: string | null) => void;
	setSessionError: (sessionKey: string, error: string | null) => void;
	shouldQueuePrompt?: (sessionKey: string) => boolean;
	startAssistantTurn: (
		sessionKey: string,
		options?: { pendingPromptStart?: boolean },
	) => void;
	uploadImages: (files: File[]) => Promise<ImageRef[]>;
}

const CONVERSATION_CHANGED_ERROR =
	"Conversation changed while images were uploading. Please resend.";

export async function dispatchBrowserPrompt<SocketLike>(
	params: DispatchBrowserPromptParams<SocketLike>,
): Promise<boolean> {
	const images = params.images ?? [];
	const prepared = preparePromptDispatch({
		input: params.input,
		hasImages: images.length > 0,
		rejectRuntimeCommandWithImages: true,
		getActiveAgentId: params.getActiveAgentId,
		getCurrentSessionKey: params.getCurrentSessionKey,
		getSocket: params.getSocket,
		isSocketOpen: params.isSocketOpen,
		sendCommand: params.sendCommand,
		setRuntimeError: params.setRuntimeError,
	});
	if (prepared.kind === "empty") {
		return false;
	}
	if (prepared.kind === "runtime") {
		return prepared.result;
	}

	const { agentId, socket, sessionKey, prompt } = prepared;

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
	const message: DisplayChatMessage = {
		kind: "chat",
		role: "user",
		content: prompt,
		images: images.map((image) => image.image),
		timestamp: Date.now(),
	};
	applyOptimisticBrowserPrompt({
		message,
		pushMessage: params.pushMessage,
		queueMessage: params.queueMessage,
		sessionKey,
		shouldQueuePrompt: params.shouldQueuePrompt,
		startAssistantTurn: params.startAssistantTurn,
	});
	params.setSessionError(sessionKey, null);
	params.setRuntimeError(null);
	return true;
}
