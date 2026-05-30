import {
	appendAssistantMessageSegment,
	assistantMessageSegmentsFromAggregates,
	assistantTextSegment,
	assistantThinkingSegment,
	hasAssistantMessageSegments,
	isAssistantActionBoundaryEvent,
	startsNewAssistantMessageSegment,
} from "../../../../common/assistant-message-segments.ts";
import { createDisplayCompactBoundaryMessage } from "../../../../common/compact-boundary.ts";
import type { AssistantMessageSegment } from "../../../../common/protocol.ts";
import { effectiveThinkingBlocks } from "../../../../common/thinking-blocks.ts";
import {
	assistantTranscriptMessage,
	type TranscriptItem,
} from "./transcript-items.ts";

export interface LiveAssistantStreamTranscriptItemsParams {
	isCompacting: boolean;
	isStreaming: boolean;
	keyPrefix?: string;
	streamingSegments?: AssistantMessageSegment[];
	streamingText: string;
	streamingThinking: string;
	streamingThinkingBlocks?: readonly string[];
	thinkingStartedAt: number | null;
}

export interface TurnFooter {
	durationMs?: number;
	timestamp: number;
}

export interface LiveTranscriptStreamEventItem {
	createdAt: number;
	event: { type?: string };
	sequence: number;
}

export type LiveTranscriptEventLike = {
	type?: string;
	[key: string]: unknown;
};

export interface LiveTranscriptItemGroup {
	key: string;
	toItem: () => TranscriptItem;
}

export type LiveTranscriptActionEventResult =
	| LiveTranscriptItemGroup
	| false
	| undefined;

export interface CompletedWorkItemParams {
	durationMs?: number;
	items: TranscriptItem[];
	sequence: number;
}

export interface LiveTranscriptStreamProjectorOptions<
	TEvent extends LiveTranscriptStreamEventItem,
> {
	createCompletedWorkItem?: (params: CompletedWorkItemParams) => TranscriptItem;
	renderActionEvent?: (
		item: TEvent,
		event: LiveTranscriptEventLike,
	) => LiveTranscriptActionEventResult;
	renderErrorEvent?: (
		item: TEvent,
		event: LiveTranscriptEventLike,
	) => LiveTranscriptItemGroup | undefined;
	renderUnknownEvent?: (
		item: TEvent,
		event: LiveTranscriptEventLike,
	) => LiveTranscriptItemGroup | undefined;
}

export interface LiveTranscriptEventProjection<
	TEvent extends LiveTranscriptStreamEventItem,
> {
	events: TEvent[];
	items: TranscriptItem[];
	reusedPreviousProjection: boolean;
}

const liveTranscriptProjectors = new WeakMap<
	object,
	LiveTranscriptStreamProjector<LiveTranscriptStreamEventItem>
>();

export function createLiveAssistantStreamTranscriptItems(
	params: LiveAssistantStreamTranscriptItemsParams,
): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const keyPrefix = params.keyPrefix ?? "streaming";
	const thinkingBlocks = effectiveThinkingBlocks({
		text: params.streamingThinking,
		blocks: params.streamingThinkingBlocks,
	});
	const segments = hasAssistantMessageSegments(params.streamingSegments)
		? (params.streamingSegments ?? [])
		: assistantMessageSegmentsFromAggregates({
				text: params.streamingText,
				thinking: params.streamingThinking,
				thinkingBlocks: params.streamingThinkingBlocks,
			});

	for (const [index, segment] of segments.entries()) {
		if (segment.type === "thinking") {
			items.push({
				kind: "thinking",
				key: `${keyPrefix}-thinking-${index}`,
				content: segment.text,
				scrollKey: `thinking:${segment.text}`,
			});
			continue;
		}
		items.push({
			kind: "message",
			key: `${keyPrefix}-text-${index}`,
			message: assistantTranscriptMessage(segment.text),
			scrollKey: `${keyPrefix}-text:${segment.text}`,
		});
	}

	if (params.isStreaming || params.isCompacting) {
		const hasAssistantOutput =
			thinkingBlocks.length > 0 || params.streamingText !== "";
		items.push({
			kind: "activity",
			key: `${keyPrefix}-activity`,
			startedAt: params.thinkingStartedAt,
			isCompacting: params.isCompacting,
			isWorking: hasAssistantOutput,
			scrollKey: [
				"activity",
				params.isStreaming ? "streaming" : "idle",
				params.isCompacting ? "compacting" : "not-compacting",
				hasAssistantOutput ? "working" : "thinking",
			].join(":"),
		});
	}

	return items;
}

export function createAssistantSegmentTranscriptItems(
	assistant: { key: string; segments: AssistantMessageSegment[] },
	footer?: TurnFooter,
	showUtilityBar = false,
): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const { key: baseKey, segments } = assistant;
	for (const [index, segment] of segments.entries()) {
		if (segment.text === "") {
			continue;
		}
		const key = segment.type === "thinking" ? `${baseKey}-${index}` : baseKey;
		if (segment.type === "thinking") {
			items.push({
				kind: "thinking",
				key,
				content: segment.text,
				scrollKey: `thinking:${segment.text}`,
			});
		} else {
			items.push({
				kind: "message",
				key,
				message: assistantTranscriptMessage(segment.text, footer),
				scrollKey: footer
					? `assistant-final:${segment.text}:${footer.timestamp}:${footer.durationMs ?? ""}`
					: `assistant:${segment.text}`,
				showUtilityBar,
			});
		}
	}
	return items;
}

export function projectLiveTranscriptStreamEvents<
	TEvent extends LiveTranscriptStreamEventItem,
>(
	previous: LiveTranscriptEventProjection<TEvent> | undefined,
	events: TEvent[],
	createProjector: () => LiveTranscriptStreamProjector<TEvent>,
): LiveTranscriptEventProjection<TEvent> {
	const previousProjector = previous
		? (liveTranscriptProjectors.get(previous) as
				| LiveTranscriptStreamProjector<TEvent>
				| undefined)
		: undefined;
	if (
		previous &&
		previousProjector &&
		liveTranscriptEventsArePrefix(previous.events, events)
	) {
		previousProjector.appendEvents(events.slice(previous.events.length));
		return rememberLiveTranscriptProjection(previousProjector, events, true);
	}

	const projector = createProjector();
	projector.appendEvents(events);
	return rememberLiveTranscriptProjection(projector, events, false);
}

export function isLiveTranscriptActionBoundaryEvent(event: {
	type: string;
}): boolean {
	return isAssistantActionBoundaryEvent(event);
}

export class LiveTranscriptStreamProjector<
	TEvent extends LiveTranscriptStreamEventItem,
> {
	private readonly groups: LiveTranscriptItemGroup[] = [];
	private currentAssistant:
		| { key: string; segments: AssistantMessageSegment[] }
		| undefined;
	private currentTurnStartedAt: number | null = null;
	private currentTurnWorkStartIndex = 0;
	private compactingStartedAt: number | null = null;
	private suppressNextEmptyDone = false;

	constructor(
		private readonly options: LiveTranscriptStreamProjectorOptions<TEvent> = {},
	) {}

	appendEvents(events: TEvent[]): void {
		for (const item of events) {
			this.appendEvent(item);
		}
	}

	items(): TranscriptItem[] {
		const items = this.groups.map((group) => group.toItem());
		if (this.currentAssistant) {
			items.push(
				...createAssistantSegmentTranscriptItems(this.currentAssistant),
			);
		}
		const compactingGroup = this.createCompactingActivityGroup();
		if (compactingGroup) {
			items.push(compactingGroup.toItem());
		}
		return items;
	}

	private flushAssistant(footer?: TurnFooter, showUtilityBar = false): boolean {
		if (!this.currentAssistant) {
			return false;
		}
		const items = createAssistantSegmentTranscriptItems(
			this.currentAssistant,
			footer,
			showUtilityBar,
		);
		for (const item of items) {
			this.groups.push({
				key: item.key,
				toItem: () => item,
			});
		}
		this.currentAssistant = undefined;
		return items.length > 0;
	}

	private recordAssistantSegment(
		segment: AssistantMessageSegment,
		sequence: number,
	): void {
		if (segment.text === "") {
			return;
		}
		const currentSegment = this.currentAssistant?.segments.at(-1);
		if (
			currentSegment &&
			startsNewAssistantMessageSegment(currentSegment, segment)
		) {
			this.flushAssistant();
		}
		if (!this.currentAssistant) {
			this.currentAssistant = {
				key: `${segment.type}-${sequence}`,
				segments: [],
			};
		}
		this.currentAssistant.segments = appendAssistantMessageSegment(
			this.currentAssistant.segments,
			segment,
		);
	}

	private flushAssistantWorkBeforeDone(): void {
		if (this.currentAssistant?.segments.at(-1)?.type === "thinking") {
			this.flushAssistant();
		}
	}

	private clearTerminalActivityState(): void {
		this.compactingStartedAt = null;
		this.suppressNextEmptyDone = false;
	}

	private elapsedCurrentTurnMs(boundaryAt: number): number | undefined {
		return this.currentTurnStartedAt === null
			? undefined
			: Math.max(0, boundaryAt - this.currentTurnStartedAt);
	}

	private eventTimeMs(item: TEvent, event: LiveTranscriptEventLike): number {
		const timestamp = event.timestamp;
		return typeof timestamp === "number" && Number.isFinite(timestamp)
			? timestamp
			: item.createdAt;
	}

	private finishCurrentTurn(): void {
		this.currentTurnStartedAt = null;
		this.currentTurnWorkStartIndex = this.groups.length;
	}

	private appendEvent(item: TEvent): void {
		const event = item.event as LiveTranscriptEventLike;
		const type = event.type;
		const eventAt = this.eventTimeMs(item, event);

		if (type === "user_prompt") {
			this.flushAssistant();
			this.collapseCurrentTurnWork({
				durationMs: this.elapsedCurrentTurnMs(eventAt),
				includeDurationOnly: false,
				sequence: item.sequence,
			});
			this.clearTerminalActivityState();
			const text = readUserPromptText(event);
			this.groups.push({
				key: `user-${item.sequence}`,
				toItem: () => ({
					kind: "message",
					key: `user-${item.sequence}`,
					message: {
						kind: "chat",
						role: "user",
						content: text,
					},
					scrollKey: `user:${text}`,
				}),
			});
			this.currentTurnWorkStartIndex = this.groups.length;
			this.currentTurnStartedAt = eventAt;
			return;
		}

		if (type === "text") {
			const text = typeof event.text === "string" ? event.text : "";
			this.recordAssistantSegment(assistantTextSegment(text), item.sequence);
			return;
		}

		if (type === "thinking") {
			const text = typeof event.text === "string" ? event.text : "";
			const blockId =
				typeof event.blockId === "string" ? event.blockId : undefined;
			this.recordAssistantSegment(
				assistantThinkingSegment(text, blockId),
				item.sequence,
			);
			return;
		}

		if (type === "done") {
			this.flushAssistantWorkBeforeDone();
			const hasFinalAssistant = this.currentAssistantHasText();
			const durationMs =
				typeof event.durationMs === "number" ? event.durationMs : undefined;
			const footer: TurnFooter = {
				timestamp: eventAt,
				...(durationMs !== undefined ? { durationMs } : {}),
			};
			this.collapseCurrentTurnWork({
				durationMs,
				includeDurationOnly:
					durationMs !== undefined && !this.suppressNextEmptyDone,
				sequence: item.sequence,
				skipCompactOnly: this.suppressNextEmptyDone && !hasFinalAssistant,
			});
			const pushedAssistant = this.flushAssistant(footer, true);
			if (!pushedAssistant && !this.suppressNextEmptyDone) {
				this.groups.push({
					key: `done-${item.sequence}`,
					toItem: () => ({
						kind: "message",
						key: `done-${item.sequence}`,
						message: assistantTranscriptMessage("", footer),
						scrollKey: `assistant-final:${footer.timestamp}:${durationMs ?? ""}`,
						showUtilityBar: true,
					}),
				});
			}
			this.clearTerminalActivityState();
			this.finishCurrentTurn();
			return;
		}

		if (type === "turn_aborted") {
			this.flushAssistant();
			this.collapseCurrentTurnWork({
				durationMs: this.elapsedCurrentTurnMs(eventAt),
				includeDurationOnly: false,
				sequence: item.sequence,
			});
			this.clearTerminalActivityState();
			this.finishCurrentTurn();
			return;
		}

		if (type === "usage_updated" || type === "image") {
			return;
		}

		this.flushAssistant();

		if (type === "compacting_started") {
			this.compactingStartedAt = eventAt;
			return;
		}

		if (type === "compacting_finished") {
			this.compactingStartedAt = null;
			this.groups.push({
				key: `compact-boundary-${item.sequence}`,
				toItem: () => ({
					kind: "message",
					key: `compact-boundary-${item.sequence}`,
					message: createDisplayCompactBoundaryMessage(),
					scrollKey: `compact-boundary:${item.sequence}`,
				}),
			});
			this.suppressNextEmptyDone = true;
			return;
		}

		const actionResult = this.options.renderActionEvent?.(item, event);
		if (actionResult === false) {
			return;
		}
		if (actionResult) {
			this.groups.push(actionResult);
			return;
		}

		if (type === "session_initialized") {
			return;
		}

		if (type === "error") {
			this.collapseCurrentTurnWork({
				durationMs: this.elapsedCurrentTurnMs(eventAt),
				includeDurationOnly: false,
				sequence: item.sequence,
			});
			const errorGroup =
				this.options.renderErrorEvent?.(item, event) ??
				createDefaultErrorGroup(item, event);
			this.groups.push(errorGroup);
			this.clearTerminalActivityState();
			this.finishCurrentTurn();
			return;
		}

		const unknownGroup = this.options.renderUnknownEvent?.(item, event);
		if (unknownGroup) {
			this.groups.push(unknownGroup);
		}
	}

	private createCompletedWorkItem(
		workGroups: LiveTranscriptItemGroup[],
		durationMs: number | undefined,
		sequence: number,
	): TranscriptItem | undefined {
		return this.options.createCompletedWorkItem?.({
			durationMs,
			items: workGroups.map((group) => group.toItem()),
			sequence,
		});
	}

	private collapseCurrentTurnWork(params: {
		durationMs?: number;
		includeDurationOnly: boolean;
		sequence: number;
		skipCompactOnly?: boolean;
	}): boolean {
		if (!this.options.createCompletedWorkItem) {
			return false;
		}
		const workGroups = this.currentTurnWorkGroups();
		if (params.skipCompactOnly === true && this.isCompactOnlyWork(workGroups)) {
			return false;
		}
		if (workGroups.length === 0 && !params.includeDurationOnly) {
			return false;
		}
		const completedWork = this.createCompletedWorkItem(
			workGroups,
			params.durationMs,
			params.sequence,
		);
		if (!completedWork) {
			return false;
		}
		this.groups.splice(
			this.currentTurnWorkStartIndex,
			this.groups.length - this.currentTurnWorkStartIndex,
			{
				key: completedWork.key,
				toItem: () =>
					this.createCompletedWorkItem(
						workGroups,
						params.durationMs,
						params.sequence,
					) ?? completedWork,
			},
		);
		return true;
	}

	private currentTurnWorkGroups(): LiveTranscriptItemGroup[] {
		const workGroups = this.groups.slice(this.currentTurnWorkStartIndex);
		const compactingGroup = this.createCompactingActivityGroup();
		if (compactingGroup) {
			workGroups.push(compactingGroup);
		}
		return workGroups;
	}

	private createCompactingActivityGroup(): LiveTranscriptItemGroup | undefined {
		if (this.compactingStartedAt === null) {
			return undefined;
		}
		const startedAt = this.compactingStartedAt;
		return {
			key: "compacting-activity",
			toItem: () => ({
				kind: "activity",
				key: "compacting-activity",
				startedAt,
				isCompacting: true,
				isWorking: false,
				scrollKey: `activity:compacting:${startedAt}`,
			}),
		};
	}

	private isCompactOnlyWork(workGroups: LiveTranscriptItemGroup[]): boolean {
		return (
			workGroups.length > 0 &&
			workGroups.every(
				(group) =>
					group.key === "compacting-activity" ||
					group.key.startsWith("compact-boundary-"),
			)
		);
	}

	private currentAssistantHasText(): boolean {
		return (
			this.currentAssistant?.segments.some(
				(segment) => segment.type === "text" && segment.text !== "",
			) ?? false
		);
	}
}

function rememberLiveTranscriptProjection<
	TEvent extends LiveTranscriptStreamEventItem,
>(
	projector: LiveTranscriptStreamProjector<TEvent>,
	events: TEvent[],
	reusedPreviousProjection: boolean,
): LiveTranscriptEventProjection<TEvent> {
	const projection: LiveTranscriptEventProjection<TEvent> = {
		events,
		items: projector.items(),
		reusedPreviousProjection,
	};
	liveTranscriptProjectors.set(
		projection,
		projector as LiveTranscriptStreamProjector<LiveTranscriptStreamEventItem>,
	);
	return projection;
}

function liveTranscriptEventsArePrefix<
	TEvent extends LiveTranscriptStreamEventItem,
>(previous: TEvent[], next: TEvent[]): boolean {
	if (previous.length > next.length) {
		return false;
	}
	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) {
			return false;
		}
	}
	return true;
}

function readUserPromptText(event: LiveTranscriptEventLike): string {
	if (typeof event.text === "string") {
		return event.text;
	}
	if (typeof event.prompt === "string") {
		return event.prompt;
	}
	return "";
}

function createDefaultErrorGroup<TEvent extends LiveTranscriptStreamEventItem>(
	item: TEvent,
	event: LiveTranscriptEventLike,
): LiveTranscriptItemGroup {
	const message =
		typeof event.message === "string" ? event.message : "Unknown error";
	return {
		key: `error-${item.sequence}`,
		toItem: () => ({
			kind: "error",
			key: `error-${item.sequence}`,
			message,
			scrollKey: `error:${message}`,
		}),
	};
}
