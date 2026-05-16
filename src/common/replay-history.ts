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

	const turnIndex = buildTurnIndex(transcript);
	let transcriptIndex = 0;

	return messages.map((message) => {
		if (message.kind !== "chat") {
			return message;
		}

		const matchedIndex = findMatchingTranscriptTurn(
			message,
			turnIndex,
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

interface TurnBucket {
	indices: number[];
	cursor: number;
}

type TurnIndex = Map<string, TurnBucket>;

function buildTurnIndex(transcript: TranscriptTurn[]): TurnIndex {
	const index: TurnIndex = new Map();
	for (let i = 0; i < transcript.length; i += 1) {
		const turn = transcript[i];
		if (!turn) {
			continue;
		}
		const key = turnKey(turn.role, turn.content, turn.replyContext?.text);
		const bucket = index.get(key);
		if (bucket) {
			bucket.indices.push(i);
		} else {
			index.set(key, { indices: [i], cursor: 0 });
		}
	}
	return index;
}

function findMatchingTranscriptTurn(
	message: DisplayChatMessage,
	turnIndex: TurnIndex,
	startIndex: number,
): number {
	const bucket = turnIndex.get(
		turnKey(message.role, message.content, message.replyContext?.text),
	);
	if (!bucket) {
		return -1;
	}
	while (
		bucket.cursor < bucket.indices.length &&
		(bucket.indices[bucket.cursor] ?? -1) < startIndex
	) {
		bucket.cursor += 1;
	}
	return bucket.cursor < bucket.indices.length
		? (bucket.indices[bucket.cursor] ?? -1)
		: -1;
}

const KEY_SEPARATOR = "\u0000";

function turnKey(
	role: "user" | "assistant",
	content: string,
	replyText: string | undefined,
): string {
	return `${role}${KEY_SEPARATOR}${replyText ?? ""}${KEY_SEPARATOR}${content}`;
}
