import {
	Bot,
	CheckCircle2,
	Circle,
	FileEdit,
	Globe,
	ListChecks,
	Terminal,
	Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DisplayChatMessage } from "../../../common/protocol.ts";
import { isCodingTranscriptSilentEvent } from "../../../common/transcript-cleanup.ts";
import { Message } from "../components/chat/message.tsx";
import { ThinkingBlock } from "../components/chat/thinking-block.tsx";
import type { CodingSessionEventStreamItem } from "../lib/api.ts";

type FacadeLike = { type?: string; [key: string]: unknown };

interface CodingEventGroup {
	key: string;
	render: () => React.ReactNode;
}

interface CodingEventViewProps {
	events: CodingSessionEventStreamItem[];
}

interface TurnFooter {
	durationMs?: number;
	timestamp: number;
}

export function CodingEventView({ events }: CodingEventViewProps) {
	const groups = useMemo(() => groupEvents(events), [events]);
	if (groups.length === 0) {
		return (
			<div className="text-sm text-dark-400">
				No turn output yet. Send a prompt to start.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{groups.map((group) => (
				<div key={group.key}>{group.render()}</div>
			))}
		</div>
	);
}

/**
 * True while the latest turn is still in flight (no terminal `done`/`error`
 * event has arrived yet). Derived directly from the event log so the spinner
 * tracks runtime state without depending on the (cached) session summary.
 */
export function isCodingTurnInFlight(
	events: CodingSessionEventStreamItem[],
): boolean {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]?.event as FacadeLike | undefined;
		const type = event?.type;
		if (type === "done" || type === "error" || type === "turn_aborted") {
			return false;
		}
		if (type === "user_prompt") {
			return true;
		}
	}
	return false;
}

function assistantMessage(
	content: string,
	footer?: TurnFooter,
): DisplayChatMessage {
	const base: DisplayChatMessage = {
		kind: "chat",
		role: "assistant",
		content,
	};
	if (!footer) {
		return base;
	}
	return {
		...base,
		timestamp: footer.timestamp,
		assistantTurn: {
			source: "user",
			...(footer.durationMs !== undefined
				? { durationMs: footer.durationMs }
				: {}),
		},
	};
}

function groupEvents(
	events: CodingSessionEventStreamItem[],
): CodingEventGroup[] {
	const groups: CodingEventGroup[] = [];
	let currentText: { key: string; chunks: string[] } | undefined;
	let currentThinking: { key: string; chunks: string[] } | undefined;
	let currentTurnWorkStartIndex = 0;
	const toolEntriesByCallId = new Map<string, ToolEntry>();

	const recordToolEvent = (
		callId: string,
		category: ToolCategory,
		event: FacadeLike,
		isStart: boolean,
		sequence: number,
	): void => {
		let entry = toolEntriesByCallId.get(callId);
		const isNew = entry === undefined;
		if (!entry) {
			entry = { callId, category, sequence };
			toolEntriesByCallId.set(callId, entry);
		}
		if (isStart) entry.started = event;
		else entry.completed = event;
		if (isNew) {
			// Capture the entry once; later events for the same callId mutate it
			// in place so the render closure picks up the final state.
			const captured = entry;
			groups.push({
				key: `tool-${callId}`,
				render: () => renderToolEntry(captured),
			});
		}
	};

	const recordCommandOutput = (
		callId: string,
		output: string,
		sequence: number,
	): void => {
		let entry = toolEntriesByCallId.get(callId);
		const isNew = entry === undefined;
		if (!entry) {
			entry = { callId, category: "command", sequence };
			toolEntriesByCallId.set(callId, entry);
		}
		entry.outputs = [...(entry.outputs ?? []), output];
		if (isNew) {
			const captured = entry;
			groups.push({
				key: `tool-${callId}`,
				render: () => renderToolEntry(captured),
			});
		}
	};

	const flushText = () => {
		if (!currentText) {
			return;
		}
		const text = currentText.chunks.join("");
		const key = currentText.key;
		groups.push({
			key,
			render: () => (
				<Message message={assistantMessage(text)} showUtilityBar={false} />
			),
		});
		currentText = undefined;
	};

	const flushThinking = () => {
		if (!currentThinking) {
			return;
		}
		const text = currentThinking.chunks.join("");
		const key = currentThinking.key;
		groups.push({
			key,
			render: () => <ThinkingBlock content={text} />,
		});
		currentThinking = undefined;
	};

	for (const item of events) {
		const event = item.event as FacadeLike;
		const type = event.type;

		if (type === "user_prompt") {
			flushText();
			flushThinking();
			const text = typeof event.text === "string" ? event.text : "";
			groups.push({
				key: `user-${item.sequence}`,
				render: () => (
					<Message
						message={{
							kind: "chat",
							role: "user",
							content: text,
						}}
					/>
				),
			});
			currentTurnWorkStartIndex = groups.length;
			continue;
		}

		if (type === "text") {
			flushThinking();
			const text = typeof event.text === "string" ? event.text : "";
			if (currentText) {
				currentText.chunks.push(text);
			} else {
				currentText = {
					key: `text-${item.sequence}`,
					chunks: [text],
				};
			}
			continue;
		}

		if (type === "thinking") {
			flushText();
			const text = typeof event.text === "string" ? event.text : "";
			if (currentThinking) {
				currentThinking.chunks.push(text);
			} else {
				currentThinking = {
					key: `thinking-${item.sequence}`,
					chunks: [text],
				};
			}
			continue;
		}

		if (type === "done") {
			flushThinking();
			const durationMs =
				typeof event.durationMs === "number" ? event.durationMs : undefined;
			const footer: TurnFooter = {
				timestamp: item.createdAt,
			};
			const workGroups = groups.slice(currentTurnWorkStartIndex);
			if (workGroups.length > 0 || durationMs !== undefined) {
				groups.splice(currentTurnWorkStartIndex, workGroups.length, {
					key: `completed-work-${item.sequence}`,
					render: () => (
						<CompletedWorkDisclosure
							durationMs={durationMs}
							groups={workGroups}
						/>
					),
				});
			}
			if (currentText) {
				const text = currentText.chunks.join("");
				const key = currentText.key;
				groups.push({
					key,
					render: () => (
						<Message message={assistantMessage(text, footer)} showUtilityBar />
					),
				});
				currentText = undefined;
			} else {
				groups.push({
					key: `done-${item.sequence}`,
					render: () => (
						<Message message={assistantMessage("", footer)} showUtilityBar />
					),
				});
			}
			currentTurnWorkStartIndex = groups.length;
			continue;
		}

		if (type === "turn_aborted") {
			flushText();
			flushThinking();
			groups.push({
				key: `turn-aborted-${item.sequence}`,
				render: () => <TurnAbortedNotice />,
			});
			currentTurnWorkStartIndex = groups.length;
			continue;
		}

		// Events that have no useful transcript projection in the coding view:
		// - usage_updated: surfaced live via the ContextGauge above the composer.
		// - image: runtime-extracted from assistant text; the path itself already
		//   appears in the message, and we have no endpoint serving arbitrary
		//   local files for inline preview.
		// - write_stdin/custom_tool_call_output: transport noise from older or
		//   partially-normalized Codex event logs; substantive command/file data
		//   is projected elsewhere and these rows only duplicate or distract.
		if (isCodingTranscriptSilentEvent(event)) {
			continue;
		}

		flushText();
		flushThinking();

		if (type === "command_execution_output") {
			const callId =
				typeof event.callId === "string" ? event.callId : String(item.sequence);
			const output = typeof event.output === "string" ? event.output : "";
			recordCommandOutput(callId, output, item.sequence);
			continue;
		}

		const toolCategory = toolCategoryFor(type);
		if (toolCategory) {
			const callId =
				typeof event.callId === "string" ? event.callId : String(item.sequence);
			recordToolEvent(
				callId,
				toolCategory.category,
				event,
				toolCategory.isStart,
				item.sequence,
			);
			continue;
		}

		if (type === "file_change_applied") {
			groups.push({
				key: `patch-${item.sequence}`,
				render: () => renderFileChange(event),
			});
			continue;
		}

		if (type === "session_initialized") {
			continue;
		}

		if (type === "error") {
			const message =
				typeof event.message === "string" ? event.message : "Unknown error";
			groups.push({
				key: `error-${item.sequence}`,
				render: () => (
					<div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
						{message}
					</div>
				),
			});
			continue;
		}

		// Fallback for unrecognized event types: render JSON.
		groups.push({
			key: `raw-${item.sequence}`,
			render: () => (
				<details className="rounded-md border border-dark-800 bg-dark-900/20 px-3 py-2 text-xs text-dark-400">
					<summary className="cursor-pointer text-dark-300">
						Event: {type ?? "unknown"}
					</summary>
					<pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] leading-4 text-dark-400">
						{JSON.stringify(event, null, 2)}
					</pre>
				</details>
			),
		});
	}

	flushText();
	flushThinking();

	return groups;
}

const COMMAND_OUTPUT_MAX_LINES = 20;
const FILE_DIFF_MAX_LINES = 60;

type ToolCategory = "command" | "web_search" | "tool_call" | "subagent";

interface ToolEntry {
	callId: string;
	category: ToolCategory;
	started?: FacadeLike;
	completed?: FacadeLike;
	outputs?: string[];
	sequence: number;
}

function CompletedWorkDisclosure({
	durationMs,
	groups,
}: {
	durationMs?: number;
	groups: CodingEventGroup[];
}) {
	const [open, setOpen] = useState(false);
	const durationLabel = formatWorkDuration(durationMs);
	const summary = durationLabel ? `Works for ${durationLabel}` : "Work details";
	const renderBody = open || typeof window === "undefined";

	return (
		<details
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="font-mono-ui cursor-pointer list-none border-b border-dark-500 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-dark-500 transition-colors hover:text-dark-300 [&::-webkit-details-marker]:hidden">
				<span className="tabular-nums">{summary}</span>
			</summary>
			{renderBody && (
				<div className="mt-2 flex flex-col gap-3">
					{groups.length > 0 ? (
						groups.map((group) => <div key={group.key}>{group.render()}</div>)
					) : (
						<div className="font-mono-ui px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-dark-600">
							No intermediate output
						</div>
					)}
				</div>
			)}
		</details>
	);
}

function formatWorkDuration(
	durationMs: number | undefined,
): string | undefined {
	if (durationMs === undefined || durationMs < 0) {
		return undefined;
	}

	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) {
		return `${hours}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`;
	}

	if (totalMinutes > 0) {
		return `${totalMinutes}m${String(seconds).padStart(2, "0")}s`;
	}

	return `${seconds}s`;
}

function TurnAbortedNotice() {
	return (
		<Message
			message={{
				kind: "system",
				event: "status",
				text: "Request interrupted by user",
			}}
		/>
	);
}

function toolCategoryFor(
	type: string | undefined,
): { category: ToolCategory; isStart: boolean } | undefined {
	switch (type) {
		case "command_execution_started":
			return { category: "command", isStart: true };
		case "command_execution_completed":
			return { category: "command", isStart: false };
		case "web_search_started":
			return { category: "web_search", isStart: true };
		case "web_search_completed":
			return { category: "web_search", isStart: false };
		case "tool_call_started":
			return { category: "tool_call", isStart: true };
		case "tool_call_completed":
			return { category: "tool_call", isStart: false };
		case "subagent_tool_started":
			return { category: "subagent", isStart: true };
		case "subagent_tool_completed":
			return { category: "subagent", isStart: false };
		default:
			return undefined;
	}
}

function renderToolEntry(entry: ToolEntry): React.ReactNode {
	switch (entry.category) {
		case "command":
			return renderCommand(entry);
		case "web_search":
			return renderWebSearch(entry);
		case "tool_call":
			return renderGenericTool(entry);
		case "subagent":
			return renderSubagent(entry);
	}
}

/**
 * Shared shell for every tool block: a collapsible card with a uniform
 * header (icon, label, truncated detail, right-aligned meta) and a body
 * area that each renderer fills with one or more {@link ToolSection}s.
 *
 * Keep visual decisions here so the five renderers stay in lockstep on
 * radius, padding, divider, and color palette.
 */
function ToolFrame({
	icon: IconComp,
	iconColorClass,
	label,
	detail,
	meta,
	isFailure,
	children,
}: {
	icon: React.ComponentType<{ className?: string }>;
	iconColorClass: string;
	label: React.ReactNode;
	detail?: React.ReactNode;
	meta?: React.ReactNode;
	isFailure?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const dividerColor = isFailure ? "border-danger/40" : "border-dark-800";
	const renderBody = open || typeof window === "undefined";
	return (
		<details
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
			className={`group overflow-hidden rounded-md border text-xs leading-5 ${
				isFailure
					? "border-danger/40 bg-danger/10"
					: "border-dark-800 bg-dark-900/30"
			}`}
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
				<IconComp
					className={`h-3.5 w-3.5 flex-shrink-0 ${
						isFailure ? "text-danger" : iconColorClass
					}`}
				/>
				<span className="flex-shrink-0 font-mono text-dark-100">{label}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-dark-300">
					{detail}
				</span>
				{meta !== undefined && meta !== null && meta !== "" && (
					<span
						className={`ml-auto flex-shrink-0 text-[10px] uppercase tracking-wide ${
							isFailure ? "text-danger" : "text-dark-500"
						}`}
					>
						{meta}
					</span>
				)}
			</summary>
			{renderBody && (
				<div className={`border-t ${dividerColor} bg-dark-950/40`}>
					{children}
				</div>
			)}
		</details>
	);
}

function ToolBody({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2 px-3 py-2 font-mono text-[11px] leading-4 text-dark-200">
			{children}
		</div>
	);
}

function ToolSection({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="text-[10px] uppercase tracking-wide text-dark-500">
				{label}
			</div>
			<div className="mt-1 space-y-2">{children}</div>
		</div>
	);
}

function ToolEmpty({ children }: { children: React.ReactNode }) {
	return <div className="italic text-dark-500">{children}</div>;
}

function DetailList({ details }: { details: ToolDetailView[] }) {
	return (
		<div className="flex flex-col gap-1">
			{details.map((detail) => (
				<div key={`${detail.label}:${detail.value.slice(0, 32)}`}>
					<span className="text-dark-500">{detail.label}: </span>
					<span className="whitespace-pre-wrap break-words text-dark-200">
						{detail.value}
					</span>
				</div>
			))}
		</div>
	);
}

function PayloadPre({ value }: { value: Record<string, unknown> }) {
	return (
		<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

/**
 * Build content-derived React keys for a list of lines so that equal lines
 * (e.g. blank ones) still get unique keys without using the array index, which
 * Biome flags as unstable.
 */
function withStableKeys(lines: string[]): Array<{ key: string; line: string }> {
	const counts = new Map<string, number>();
	return lines.map((line) => {
		const head = line.slice(0, 32);
		const seen = counts.get(head) ?? 0;
		counts.set(head, seen + 1);
		return { key: seen === 0 ? head : `${head}#${seen}`, line };
	});
}

function renderCommand(entry: ToolEntry): React.ReactNode {
	const command =
		(entry.started?.command as string | undefined) ??
		(entry.completed?.command as string | undefined) ??
		"<unknown command>";
	const exitCode = entry.completed?.exitCode as number | undefined;
	const streamedOutput = entry.outputs?.join("") ?? "";
	const output =
		typeof entry.completed?.output === "string"
			? (entry.completed?.output as string)
			: streamedOutput || undefined;
	const isPending = !entry.completed;
	const isFailure =
		!isPending && typeof exitCode === "number" && exitCode !== 0;
	const meta = isPending ? "running…" : undefined;

	return (
		<ToolFrame
			icon={Terminal}
			iconColorClass="text-orange-400"
			label="bash"
			detail={command}
			meta={meta}
			isFailure={isFailure}
		>
			<ToolBody>
				<ToolSection label="input">
					<div className="whitespace-pre-wrap break-words">{command}</div>
				</ToolSection>
				<ToolSection label="output">
					{renderCommandOutput(output, isPending)}
				</ToolSection>
			</ToolBody>
		</ToolFrame>
	);
}

function renderWebSearch(entry: ToolEntry): React.ReactNode {
	const startedQuery =
		typeof entry.started?.query === "string"
			? (entry.started.query as string)
			: "";
	const completedQuery =
		typeof entry.completed?.query === "string"
			? (entry.completed.query as string)
			: "";
	const query = completedQuery || startedQuery;
	const queries = Array.isArray(entry.completed?.queries)
		? (entry.completed?.queries as unknown[]).filter(
				(q): q is string => typeof q === "string",
			)
		: [];
	const isPending = !entry.completed;
	const meta = isPending ? "searching…" : "completed";

	return (
		<ToolFrame
			icon={Globe}
			iconColorClass="text-cyan-400"
			label="web_search"
			detail={query || "(query pending)"}
			meta={meta}
		>
			<ToolBody>
				{queries.length > 1 ? (
					<ToolSection label="queries">
						<ul className="list-disc pl-4">
							{queries.map((q) => (
								<li key={q}>{q}</li>
							))}
						</ul>
					</ToolSection>
				) : (
					<ToolEmpty>
						{isPending ? "searching…" : "(no extra detail)"}
					</ToolEmpty>
				)}
			</ToolBody>
		</ToolFrame>
	);
}

function renderGenericTool(entry: ToolEntry): React.ReactNode {
	const toolKind =
		(typeof entry.started?.toolKind === "string"
			? (entry.started.toolKind as string)
			: undefined) ??
		(typeof entry.completed?.toolKind === "string"
			? (entry.completed.toolKind as string)
			: undefined) ??
		"tool";
	if (toolKind === "collabAgentToolCall") {
		return renderSubagent(entry);
	}
	if (toolKind === "update_plan") {
		return renderUpdatePlan(entry);
	}
	const isPending = !entry.completed;
	const status =
		typeof entry.completed?.status === "string"
			? (entry.completed.status as string)
			: undefined;
	const meta = isPending ? "running…" : (status ?? "completed");
	const isFailure = !isPending && status === "failed";
	const startedPayload = asPayloadRecord(entry.started?.payload);
	const completedPayload = asPayloadRecord(entry.completed?.payload);
	const startedDetails = readToolDetails(entry.started?.details);
	const completedDetails = readToolDetails(entry.completed?.details);
	const showCompletedDetails =
		completedDetails.length > 0 &&
		!sameToolDetails(startedDetails, completedDetails);
	const showCompletedPayload =
		!!completedPayload && completedPayload !== startedPayload;
	const hasInput = startedDetails.length > 0 || !!startedPayload;
	const hasOutput = showCompletedDetails || showCompletedPayload;
	const headerDetail =
		startedDetails[0]?.value ?? completedDetails[0]?.value ?? "";

	return (
		<ToolFrame
			icon={Wrench}
			iconColorClass="text-violet-400"
			label={toolKind}
			detail={headerDetail}
			meta={meta}
			isFailure={isFailure}
		>
			<ToolBody>
				{hasInput && (
					<ToolSection label="input">
						{startedDetails.length > 0 && (
							<DetailList details={startedDetails} />
						)}
						{startedPayload && <PayloadPre value={startedPayload} />}
					</ToolSection>
				)}
				{hasOutput && (
					<ToolSection label="output">
						{showCompletedDetails && <DetailList details={completedDetails} />}
						{showCompletedPayload && completedPayload && (
							<PayloadPre value={completedPayload} />
						)}
					</ToolSection>
				)}
				{!hasInput && !hasOutput && (
					<ToolEmpty>{isPending ? "running…" : "(no detail)"}</ToolEmpty>
				)}
			</ToolBody>
		</ToolFrame>
	);
}

interface ToolDetailView {
	label: string;
	value: string;
}

function readToolDetails(value: unknown): ToolDetailView[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry) => {
			const record =
				entry && typeof entry === "object"
					? (entry as Record<string, unknown>)
					: undefined;
			const label =
				typeof record?.label === "string" ? record.label : undefined;
			const detailValue =
				typeof record?.value === "string" ? record.value : undefined;
			if (!label || detailValue === undefined) {
				return undefined;
			}
			return { label, value: detailValue };
		})
		.filter((entry): entry is ToolDetailView => entry !== undefined);
}

function sameToolDetails(
	left: ToolDetailView[],
	right: ToolDetailView[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((entry, index) => {
		const candidate = right[index];
		return (
			candidate !== undefined &&
			entry.label === candidate.label &&
			entry.value === candidate.value
		);
	});
}

function asPayloadRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	return Object.keys(record).length === 0 ? undefined : record;
}

interface UpdatePlanStep {
	step: string;
	status: string;
}

function renderUpdatePlan(entry: ToolEntry): React.ReactNode {
	// Codex delivers `update_plan` as a function_call whose `arguments` field
	// is a JSON-encoded `{ explanation, plan }` payload, flattened by the
	// normalizer into a single detail entry. The completion side only carries
	// a "Plan updated" acknowledgement — drop it in favor of the structured
	// step list.
	const args =
		readUpdatePlanArguments(entry.started) ??
		readUpdatePlanArguments(entry.completed);
	const explanation = args?.explanation;
	const steps = args?.steps ?? [];
	const isPending = !entry.completed;
	const summary = explanation
		? truncate(explanation, 96)
		: steps.length > 0
			? `${steps.length} step${steps.length === 1 ? "" : "s"}`
			: "update_plan";
	const meta = isPending
		? "updating…"
		: steps.length > 0
			? planProgressLabel(steps)
			: undefined;
	const hasBody = !!explanation || steps.length > 0;

	return (
		<ToolFrame
			icon={ListChecks}
			iconColorClass="text-sky-400"
			label="update_plan"
			detail={summary}
			meta={meta}
		>
			<ToolBody>
				{explanation && (
					<ToolSection label="description">
						<div className="whitespace-pre-wrap break-words text-dark-100">
							{explanation}
						</div>
					</ToolSection>
				)}
				{steps.length > 0 && (
					<ToolSection label="steps">
						<ul className="flex flex-col gap-1">
							{withStableKeys(steps.map((step) => step.step)).map(
								({ key }, index) => {
									const step = steps[index];
									if (!step) return null;
									return <PlanStepRow key={key} step={step} />;
								},
							)}
						</ul>
					</ToolSection>
				)}
				{!hasBody && (
					<ToolEmpty>{isPending ? "updating…" : "(no plan)"}</ToolEmpty>
				)}
			</ToolBody>
		</ToolFrame>
	);
}

function PlanStepRow({ step }: { step: UpdatePlanStep }) {
	const { Icon, iconClass, textClass } = planStepStyle(step.status);
	return (
		<li className="flex items-center gap-2">
			<Icon className={`h-3.5 w-3.5 flex-shrink-0 ${iconClass}`} />
			<span className={`whitespace-pre-wrap break-words ${textClass}`}>
				{step.step}
			</span>
		</li>
	);
}

function planStepStyle(status: string): {
	Icon: React.ComponentType<{ className?: string }>;
	iconClass: string;
	textClass: string;
} {
	switch (status) {
		case "completed":
			return {
				Icon: CheckCircle2,
				iconClass: "text-emerald-500/60",
				textClass: "text-dark-500",
			};
		case "in_progress":
			return {
				Icon: Circle,
				iconClass: "text-amber-400",
				textClass: "text-amber-400/70 italic",
			};
		case "failed":
		case "blocked":
			return {
				Icon: Circle,
				iconClass: "text-rose-400",
				textClass: "text-rose-300",
			};
		default:
			return {
				Icon: Circle,
				iconClass: "text-dark-500",
				textClass: "text-dark-200",
			};
	}
}

function readUpdatePlanArguments(
	event: FacadeLike | undefined,
): { explanation?: string; steps: UpdatePlanStep[] } | undefined {
	if (!event) {
		return undefined;
	}
	const fromDetails = readToolDetails(event.details).find(
		(detail) => detail.label === "arguments",
	);
	const raw = fromDetails?.value;
	if (typeof raw !== "string" || raw.length === 0) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	const explanation =
		typeof record.explanation === "string" ? record.explanation : undefined;
	const steps = Array.isArray(record.plan)
		? record.plan
				.map((entry): UpdatePlanStep | undefined => {
					if (!entry || typeof entry !== "object") {
						return undefined;
					}
					const stepRecord = entry as Record<string, unknown>;
					const stepText =
						typeof stepRecord.step === "string" ? stepRecord.step : undefined;
					const status =
						typeof stepRecord.status === "string"
							? stepRecord.status
							: undefined;
					if (!stepText || !status) {
						return undefined;
					}
					return { step: stepText, status };
				})
				.filter((step): step is UpdatePlanStep => step !== undefined)
		: [];
	if (!explanation && steps.length === 0) {
		return undefined;
	}
	return { ...(explanation ? { explanation } : {}), steps };
}

function planProgressLabel(steps: UpdatePlanStep[]): string | undefined {
	if (steps.length === 0) return undefined;
	const completed = steps.filter((step) => step.status === "completed").length;
	return `${completed}/${steps.length} done`;
}

interface SubagentState {
	status?: string;
	message?: string;
}

function renderSubagent(entry: ToolEntry): React.ReactNode {
	// Codex normalizes spawn / wait / send_input subagent operations into a
	// single `collabAgentToolCall` item kind. Pull the meaningful fields out
	// of the payload instead of dumping JSON — the substantive content is
	// the prompt the parent sent and the message each child sent back.
	const startedPayload = asPayloadRecord(entry.started?.payload) ?? {};
	const completedPayload = asPayloadRecord(entry.completed?.payload) ?? {};
	const startedTyped = readTypedSubagentFields(entry.started);
	const completedTyped = readTypedSubagentFields(entry.completed);
	const merged: Record<string, unknown> = {
		...startedPayload,
		...completedPayload,
		...startedTyped,
		...completedTyped,
	};
	const operation =
		typeof merged.operation === "string"
			? (merged.operation as string)
			: typeof merged.tool === "string"
				? (merged.tool as string)
				: "subagent";
	const subOp = subagentOpLabel(operation);
	const prompt =
		typeof merged.prompt === "string" && merged.prompt
			? (merged.prompt as string)
			: undefined;
	const receiverThreadIds =
		readStringArray(merged.targetIds) ??
		readStringArray(merged.receiverThreadIds) ??
		[];
	const agentsStates = readAgentsStates(
		merged.agentStates ?? merged.agentsStates,
	);
	const isPending = !entry.completed;
	const explicitStatus =
		typeof entry.completed?.status === "string"
			? (entry.completed.status as string)
			: undefined;
	const meta = isPending
		? "running…"
		: (subagentOverallStatus(agentsStates) ?? explicitStatus ?? "completed");

	const summary =
		subOp === "wait"
			? `${receiverThreadIds.length} agent${
					receiverThreadIds.length === 1 ? "" : "s"
				}`
			: prompt
				? truncate(prompt, 96)
				: subOp;

	const targetIds =
		receiverThreadIds.length > 0 ? receiverThreadIds : [...agentsStates.keys()];
	const hasBody = !!prompt || targetIds.length > 0;

	return (
		<ToolFrame
			icon={Bot}
			iconColorClass="text-indigo-400"
			label={`subagent · ${subOp}`}
			detail={summary}
			meta={meta}
		>
			<ToolBody>
				{prompt && (
					<ToolSection label="prompt">
						<div className="whitespace-pre-wrap break-words">{prompt}</div>
					</ToolSection>
				)}
				{targetIds.length > 0 && (
					<ToolSection label={subOp === "wait" ? "targets" : "spawned"}>
						<div className="flex flex-col gap-1">
							{targetIds.map((agentId) => {
								const state = agentsStates.get(agentId);
								return (
									<SubagentRow key={agentId} agentId={agentId} state={state} />
								);
							})}
						</div>
					</ToolSection>
				)}
				{!hasBody && (
					<ToolEmpty>{isPending ? "running…" : "(no detail)"}</ToolEmpty>
				)}
			</ToolBody>
		</ToolFrame>
	);
}

function SubagentRow({
	agentId,
	state,
}: {
	agentId: string;
	state: SubagentState | undefined;
}) {
	return (
		<div>
			<div className="flex items-baseline gap-2 text-[10px] text-dark-500">
				<span className="break-all font-mono text-dark-300">{agentId}</span>
				{state?.status && (
					<span
						className={`uppercase tracking-wide ${subagentStatusClass(state.status)}`}
					>
						{state.status}
					</span>
				)}
			</div>
			{state?.message && (
				<div className="mt-1 whitespace-pre-wrap break-words font-mono text-dark-200">
					{state.message}
				</div>
			)}
		</div>
	);
}

function subagentOpLabel(tool: string): string {
	switch (tool) {
		case "spawnAgent":
			return "spawn";
		case "wait":
			return "wait";
		case "sendInput":
			return "send";
		case "resume":
			return "resume";
		case "close":
			return "close";
		default:
			return tool;
	}
}

function readTypedSubagentFields(
	event: FacadeLike | undefined,
): Record<string, unknown> {
	if (!event) {
		return {};
	}
	const result: Record<string, unknown> = {};
	for (const key of [
		"operation",
		"prompt",
		"model",
		"reasoningEffort",
		"targetIds",
		"agentStates",
	]) {
		if (event[key] !== undefined) {
			result[key] = event[key];
		}
	}
	return result;
}

function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	return value.filter((entry): entry is string => typeof entry === "string");
}

function readAgentsStates(value: unknown): Map<string, SubagentState> {
	const result = new Map<string, SubagentState>();
	if (Array.isArray(value)) {
		for (const rawState of value) {
			const stateRecord = asPayloadRecord(rawState);
			if (!stateRecord) {
				continue;
			}
			const agentId =
				typeof stateRecord.agentId === "string"
					? stateRecord.agentId
					: undefined;
			if (!agentId) {
				continue;
			}
			const state: SubagentState = {};
			if (typeof stateRecord.status === "string") {
				state.status = stateRecord.status;
			}
			if (typeof stateRecord.message === "string") {
				state.message = stateRecord.message;
			}
			result.set(agentId, state);
		}
		return result;
	}
	if (!value || typeof value !== "object") return result;
	for (const [agentId, raw] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (!raw || typeof raw !== "object") continue;
		const record = raw as Record<string, unknown>;
		const state: SubagentState = {};
		if (typeof record.status === "string") state.status = record.status;
		if (typeof record.message === "string") state.message = record.message;
		result.set(agentId, state);
	}
	return result;
}

function subagentOverallStatus(
	states: Map<string, SubagentState>,
): string | undefined {
	if (states.size === 0) return undefined;
	const statuses = [...states.values()]
		.map((s) => s.status)
		.filter((s): s is string => typeof s === "string");
	if (statuses.length === 0) return undefined;
	if (statuses.some((s) => s === "failed")) return "failed";
	if (statuses.every((s) => s === "completed")) return "completed";
	return "running";
}

function subagentStatusClass(status: string): string {
	switch (status) {
		case "completed":
			return "text-emerald-400";
		case "failed":
			return "text-danger";
		case "running":
		case "pendingInit":
			return "text-amber-400";
		default:
			return "text-dark-400";
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

function renderCommandOutput(
	output: string | undefined,
	isPending: boolean,
): React.ReactNode {
	if (!output) {
		return <ToolEmpty>{isPending ? "running…" : "No output"}</ToolEmpty>;
	}
	const lines = output.split("\n");
	const truncated = lines.length > COMMAND_OUTPUT_MAX_LINES;
	const visible = withStableKeys(
		truncated ? lines.slice(0, COMMAND_OUTPUT_MAX_LINES) : lines,
	);
	return (
		<div className="max-h-72 overflow-auto">
			{visible.map(({ key, line }) => (
				<div key={key} className="whitespace-pre">
					{line || " "}
				</div>
			))}
			{truncated && (
				<div className="mt-1 italic text-dark-500">
					… {lines.length - COMMAND_OUTPUT_MAX_LINES} more lines
				</div>
			)}
		</div>
	);
}

interface FileChangeEntry {
	path?: unknown;
	kind?: unknown;
	diff?: unknown;
	movePath?: unknown;
}

function renderFileChange(event: FacadeLike): React.ReactNode {
	const changes = Array.isArray(event.changes)
		? (event.changes as FileChangeEntry[])
		: [];
	const fileWord = changes.length === 1 ? "file" : "files";

	return (
		<ToolFrame
			icon={FileEdit}
			iconColorClass="text-yellow-400"
			label="file_change"
			meta={`${changes.length} ${fileWord}`}
		>
			<div className="flex flex-col">
				{changes.map((change, index) => (
					<FileChangePanel
						key={`${String(change.kind ?? "?")}:${String(change.path ?? index)}`}
						change={change}
					/>
				))}
			</div>
		</ToolFrame>
	);
}

function FileChangePanel({ change }: { change: FileChangeEntry }) {
	const path = typeof change.path === "string" ? change.path : "?";
	const kind = typeof change.kind === "string" ? change.kind : "unknown";
	const diff = typeof change.diff === "string" ? change.diff : "";
	const movePath =
		typeof change.movePath === "string" ? change.movePath : undefined;
	return (
		<div className="border-b border-dark-800/40 last:border-b-0">
			<div className="flex items-baseline gap-2 bg-dark-900/50 px-3 py-1.5">
				<span
					className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${kindClass(kind)}`}
				>
					{kind}
				</span>
				<span className="truncate font-mono text-dark-100">{path}</span>
				{movePath && (
					<span className="truncate font-mono text-dark-400">→ {movePath}</span>
				)}
			</div>
			{diff && renderDiff(diff)}
		</div>
	);
}

function renderDiff(diff: string): React.ReactNode {
	const lines = diff.split("\n");
	const truncated = lines.length > FILE_DIFF_MAX_LINES;
	const visible = withStableKeys(
		truncated ? lines.slice(0, FILE_DIFF_MAX_LINES) : lines,
	);
	return (
		<div className="max-h-72 overflow-auto bg-dark-950/40 font-mono text-[11px] leading-4">
			{visible.map(({ key, line }) => (
				<div key={key} className={`px-3 whitespace-pre ${diffLineClass(line)}`}>
					{line || " "}
				</div>
			))}
			{truncated && (
				<div className="px-3 py-1 italic text-dark-500">
					… {lines.length - FILE_DIFF_MAX_LINES} more lines
				</div>
			)}
		</div>
	);
}

function diffLineClass(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) {
		return "bg-dark-900/40 text-dark-400";
	}
	if (line.startsWith("+")) {
		return "bg-emerald-950/40 text-emerald-400";
	}
	if (line.startsWith("-")) {
		return "bg-rose-950/40 text-rose-400";
	}
	if (line.startsWith("@@")) {
		return "bg-sky-950/30 text-sky-300";
	}
	return "text-dark-300";
}

function kindClass(kind: string): string {
	switch (kind) {
		case "add":
			return "bg-emerald-500/15 text-emerald-300";
		case "delete":
			return "bg-rose-500/15 text-rose-300";
		case "move":
			return "bg-sky-500/15 text-sky-300";
		default:
			return "bg-dark-700/40 text-dark-200";
	}
}
