import type {
	DisplayChatMessage,
	DisplayMessage,
	TranscriptTurn,
} from "./protocol.ts";

export function annotateHistoryWithTranscript(
	messages: DisplayMessage[],
	transcript: TranscriptTurn[] | undefined,
): DisplayMessage[] {
	if (!transcript || transcript.length === 0) {
		return messages;
	}

	let transcriptIndex = 0;

	return messages.map((message) => {
		if (message.kind !== "chat") {
			return message;
		}

		const matchedIndex = findMatchingTranscriptTurn(
			message,
			transcript,
			transcriptIndex,
		);
		if (matchedIndex === -1) {
			return message;
		}

		transcriptIndex = matchedIndex + 1;
		return {
			...message,
			timestamp: transcript[matchedIndex]?.timestamp,
		};
	});
}

function findMatchingTranscriptTurn(
	message: DisplayChatMessage,
	transcript: TranscriptTurn[],
	startIndex: number,
): number {
	for (let index = startIndex; index < transcript.length; index += 1) {
		const turn = transcript[index];
		if (!turn) {
			continue;
		}

		if (
			turn.role === message.role &&
			turn.content === message.content &&
			(turn.replyContext?.text ?? "") === (message.replyContext?.text ?? "")
		) {
			return index;
		}
	}

	return -1;
}
