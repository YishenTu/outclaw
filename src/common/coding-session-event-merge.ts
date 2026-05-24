import {
	appendAssistantMessageSegment,
	assistantTextSegment,
	assistantThinkingSegment,
} from "./assistant-message-segments.ts";
import type {
	AssistantMessageSegment,
	CodingSessionEvent,
} from "./protocol.ts";

type CodingEventSignaturePart =
	| { type: "event"; key: string }
	| { type: "text"; text: string }
	| { type: "thinking"; text: string };

export function isCodingSessionTerminalEvent(
	event: Pick<CodingSessionEvent, "type">,
): boolean {
	return (
		event.type === "done" ||
		event.type === "error" ||
		event.type === "turn_aborted"
	);
}

export function codingSessionEventsSettleLatestTurn(
	events: CodingSessionEvent[],
): boolean {
	let sawTerminal = false;
	let latestTurnOpen = false;
	for (const event of events) {
		if (event.type === "user_prompt") {
			latestTurnOpen = true;
			continue;
		}
		if (isCodingSessionTerminalEvent(event)) {
			sawTerminal = true;
			latestTurnOpen = false;
		}
	}
	return sawTerminal && !latestTurnOpen;
}

export function countCodingSessionHistorySuffixCoveredByLive(
	history: CodingSessionEvent[],
	liveSnapshot: CodingSessionEvent[],
): number {
	const semanticOverlap = findSemanticHistorySuffixInLiveSnapshot(
		history,
		liveSnapshot,
	);
	if (semanticOverlap > 0) {
		return semanticOverlap;
	}

	const maxLength = Math.min(history.length, liveSnapshot.length);
	for (let length = maxLength; length > 0; length -= 1) {
		const historyStart = history.length - length;
		for (
			let snapshotStart = 0;
			snapshotStart <= liveSnapshot.length - length;
			snapshotStart += 1
		) {
			let matches = true;
			for (let offset = 0; offset < length; offset += 1) {
				const historyEvent = history[historyStart + offset];
				const liveEvent = liveSnapshot[snapshotStart + offset];
				if (
					!historyEvent ||
					!liveEvent ||
					codingSessionEventKey(historyEvent) !==
						codingSessionEventKey(liveEvent)
				) {
					matches = false;
					break;
				}
			}
			if (matches) {
				return length;
			}
		}
	}
	return 0;
}

export function countCodingSessionLivePrefixCoveredByHistory(
	history: CodingSessionEvent[],
	liveSnapshot: CodingSessionEvent[],
): number {
	if (history.length === 0 || liveSnapshot.length === 0) {
		return 0;
	}
	const leadingSessionInitialized =
		liveSnapshot[0]?.type === "session_initialized" &&
		history[0]?.type !== "session_initialized"
			? 1
			: 0;
	if (leadingSessionInitialized === liveSnapshot.length) {
		return leadingSessionInitialized;
	}
	for (
		let length = liveSnapshot.length - leadingSessionInitialized;
		length > 0;
		length -= 1
	) {
		const end = leadingSessionInitialized + length;
		const candidate = liveSnapshot.slice(leadingSessionInitialized, end);
		if (codingSessionEventSequenceCoveredByHistory(history, candidate)) {
			return end;
		}
	}
	return 0;
}

export function codingSessionEventKey(event: CodingSessionEvent): string {
	if (event.type === "user_prompt") {
		return JSON.stringify({
			type: event.type,
			text: event.text,
			...(event.images ? { images: event.images } : {}),
		});
	}
	if (event.type === "done") {
		return JSON.stringify({ type: event.type });
	}
	if (event.type === "turn_aborted") {
		return JSON.stringify({ type: event.type });
	}

	return JSON.stringify(stableCodingSessionEventRecord(event));
}

function findSemanticHistorySuffixInLiveSnapshot(
	history: CodingSessionEvent[],
	liveSnapshot: CodingSessionEvent[],
): number {
	for (let historyStart = 0; historyStart < history.length; historyStart += 1) {
		if (history[historyStart]?.type !== "user_prompt") {
			continue;
		}
		const historySignature = buildCodingEventSignature(
			history.slice(historyStart),
		);
		for (
			let snapshotStart = 0;
			snapshotStart < liveSnapshot.length;
			snapshotStart += 1
		) {
			if (liveSnapshot[snapshotStart]?.type !== "user_prompt") {
				continue;
			}
			const liveSignature = buildCodingEventSignature(
				liveSnapshot.slice(snapshotStart),
			);
			if (codingEventSignatureCoveredByLive(historySignature, liveSignature)) {
				return history.length - historyStart;
			}
		}
	}

	return 0;
}

function codingSessionEventSequenceCoveredByHistory(
	history: CodingSessionEvent[],
	sequence: CodingSessionEvent[],
): boolean {
	if (sequence.length === 0) {
		return true;
	}
	const sequenceSignature = buildCodingEventSignature(sequence);
	for (let historyStart = 0; historyStart < history.length; historyStart += 1) {
		const historySignature = buildCodingEventSignature(
			history.slice(historyStart),
		);
		if (
			codingEventSignatureCoveredByLive(sequenceSignature, historySignature)
		) {
			return true;
		}
	}
	return false;
}

function buildCodingEventSignature(
	events: CodingSessionEvent[],
): CodingEventSignaturePart[] {
	const signature: CodingEventSignaturePart[] = [];
	let segments: AssistantMessageSegment[] = [];

	const flushSegments = () => {
		for (const segment of segments) {
			signature.push({ type: segment.type, text: segment.text });
		}
		segments = [];
	};

	for (const event of events) {
		if (event.type === "text") {
			segments = appendAssistantMessageSegment(
				segments,
				assistantTextSegment(event.text),
			);
			continue;
		}
		if (event.type === "thinking") {
			segments = appendAssistantMessageSegment(
				segments,
				assistantThinkingSegment(event.text, event.blockId),
			);
			continue;
		}

		flushSegments();
		signature.push({ type: "event", key: codingSessionEventKey(event) });
	}

	flushSegments();
	return signature;
}

function codingEventSignatureCoveredByLive(
	history: CodingEventSignaturePart[],
	live: CodingEventSignaturePart[],
): boolean {
	if (history.length === 0 || live.length < history.length) {
		return false;
	}

	return history.every((part, index) => {
		const livePart = live[index];
		if (!livePart || livePart.type !== part.type) {
			return false;
		}
		if (part.type === "event") {
			return livePart.type === "event" && livePart.key === part.key;
		}
		return livePart.type === part.type && livePart.text.startsWith(part.text);
	});
}

function stableCodingSessionEventRecord(
	event: CodingSessionEvent,
): Record<string, unknown> {
	const record = { ...event } as Record<string, unknown>;
	delete record.durationMs;
	delete record.sessionId;
	delete record.timestamp;
	delete record.usage;
	delete record.blockId;
	return record;
}
