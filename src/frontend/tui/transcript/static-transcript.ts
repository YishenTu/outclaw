import { type ReactNode, useRef } from "react";
import type { TuiMessage } from "./state.ts";

export type StaticTranscriptItem =
	| {
			kind: "prefix";
			key: string;
			node: ReactNode;
	  }
	| {
			kind: "message";
			key: string;
			message: TuiMessage;
	  };

interface StaticTranscriptState {
	items: StaticTranscriptItem[];
	renderedMessageCount: number;
	transcriptVersion: number;
}

function createMessageItem(
	message: TuiMessage,
	transcriptVersion: number,
): StaticTranscriptItem {
	return {
		kind: "message",
		key: `${transcriptVersion}:message:${message.id}`,
		message,
	};
}

function createPrefixItem(
	staticPrefix: ReactNode,
	transcriptVersion: number,
): StaticTranscriptItem {
	return {
		kind: "prefix",
		key: `${transcriptVersion}:prefix`,
		node: staticPrefix,
	};
}

function initialStaticItems(
	staticPrefix: ReactNode,
	messages: TuiMessage[],
	staticMessageCount: number,
	transcriptVersion: number,
): StaticTranscriptItem[] {
	const items: StaticTranscriptItem[] = [];
	if (staticPrefix) {
		items.push(createPrefixItem(staticPrefix, transcriptVersion));
	}
	for (const message of messages.slice(0, staticMessageCount)) {
		items.push(createMessageItem(message, transcriptVersion));
	}
	return items;
}

export function useAppendOnlyStaticTranscript(
	messages: TuiMessage[],
	staticMessageCount: number,
	transcriptVersion: number,
	staticPrefix: ReactNode,
): StaticTranscriptItem[] {
	const stateRef = useRef<StaticTranscriptState | null>(null);

	if (!stateRef.current) {
		stateRef.current = {
			items: initialStaticItems(
				staticPrefix,
				messages,
				staticMessageCount,
				transcriptVersion,
			),
			renderedMessageCount: staticMessageCount,
			transcriptVersion,
		};
		return stateRef.current.items;
	}

	const state = stateRef.current;
	if (state.transcriptVersion !== transcriptVersion) {
		state.items = [
			...state.items,
			...(staticPrefix
				? [createPrefixItem(staticPrefix, transcriptVersion)]
				: []),
			...messages
				.slice(0, staticMessageCount)
				.map((message) => createMessageItem(message, transcriptVersion)),
		];
		state.renderedMessageCount = staticMessageCount;
		state.transcriptVersion = transcriptVersion;
		return state.items;
	}

	if (staticMessageCount > state.renderedMessageCount) {
		state.items = [
			...state.items,
			...messages
				.slice(state.renderedMessageCount, staticMessageCount)
				.map((message) => createMessageItem(message, transcriptVersion)),
		];
	}
	state.renderedMessageCount = staticMessageCount;
	return state.items;
}
