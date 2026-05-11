import type { DisplayChatMessage } from "../../../common/protocol.ts";
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
	const groups = groupEvents(events);
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
		if (type === "done" || type === "error") {
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
	let currentText:
		| { key: string; chunks: string[]; turnFooter?: TurnFooter }
		| undefined;
	let currentThinking: { key: string; chunks: string[] } | undefined;
	const commandsByCallId = new Map<
		string,
		{
			started?: FacadeLike;
			completed?: FacadeLike;
			sequence: number;
		}
	>();

	const flushText = () => {
		if (!currentText) {
			return;
		}
		const text = currentText.chunks.join("");
		const key = currentText.key;
		const footer = currentText.turnFooter;
		groups.push({
			key,
			render: () => (
				<Message
					message={assistantMessage(text, footer)}
					showUtilityBar={footer !== undefined}
				/>
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
				...(durationMs !== undefined ? { durationMs } : {}),
			};
			if (currentText) {
				currentText.turnFooter = footer;
				flushText();
			} else {
				groups.push({
					key: `done-${item.sequence}`,
					render: () => (
						<Message message={assistantMessage("", footer)} showUtilityBar />
					),
				});
			}
			continue;
		}

		flushText();
		flushThinking();

		if (
			type === "command_execution_started" ||
			type === "command_execution_completed"
		) {
			const callId =
				typeof event.callId === "string" ? event.callId : String(item.sequence);
			let entry = commandsByCallId.get(callId);
			const isNew = entry === undefined;
			if (!entry) {
				entry = { sequence: item.sequence };
				commandsByCallId.set(callId, entry);
			}
			if (type === "command_execution_started") {
				entry.started = event;
			} else {
				entry.completed = event;
			}
			if (isNew) {
				// Capture the entry once; later events for the same callId mutate it
				// in place so the existing render closure picks up the final state.
				const captured = entry;
				groups.push({
					key: `command-${callId}`,
					render: () => renderCommand(captured),
				});
			}
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
			groups.push({
				key: `init-${item.sequence}`,
				render: () => (
					<div className="text-xs uppercase tracking-wide text-dark-500">
						Session started: {item.sdkSessionId}
					</div>
				),
			});
			continue;
		}

		if (type === "error") {
			const message =
				typeof event.message === "string" ? event.message : "Unknown error";
			groups.push({
				key: `error-${item.sequence}`,
				render: () => (
					<div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
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
				<details className="rounded-xl border border-dark-800 bg-dark-900/20 px-4 py-2 text-xs text-dark-400">
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

function renderCommand(entry: {
	started?: FacadeLike;
	completed?: FacadeLike;
}): React.ReactNode {
	const command =
		(entry.started?.command as string | undefined) ??
		(entry.completed?.command as string | undefined) ??
		"<unknown command>";
	const cwd = entry.started?.cwd as string | undefined;
	const exitCode = entry.completed?.exitCode as number | undefined;
	const durationMs = entry.completed?.durationMs as number | undefined;
	const output =
		typeof entry.completed?.output === "string"
			? (entry.completed?.output as string)
			: undefined;
	const isPending = !entry.completed;
	const isFailure =
		!isPending && typeof exitCode === "number" && exitCode !== 0;

	return (
		<div
			className={`rounded-xl border px-4 py-3 text-xs leading-5 ${
				isFailure
					? "border-danger/40 bg-danger/10"
					: "border-dark-800 bg-dark-900/30"
			}`}
		>
			<div className="flex items-center gap-2 text-dark-300">
				<span className="font-mono text-dark-200">$</span>
				<span className="font-mono text-dark-100">{command}</span>
				{isPending && (
					<span className="ml-auto text-[10px] uppercase tracking-wide text-dark-500">
						running…
					</span>
				)}
				{!isPending && (
					<span
						className={`ml-auto text-[10px] uppercase tracking-wide ${
							isFailure ? "text-danger" : "text-dark-500"
						}`}
					>
						exit {exitCode ?? "?"}
						{durationMs !== undefined ? ` · ${durationMs}ms` : ""}
					</span>
				)}
			</div>
			{cwd && (
				<div className="mt-1 text-[10px] uppercase tracking-wide text-dark-500">
					{cwd}
				</div>
			)}
			{output && (
				<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-dark-950/60 px-2 py-2 font-mono text-[11px] leading-4 text-dark-200">
					{output}
				</pre>
			)}
		</div>
	);
}

function renderFileChange(event: FacadeLike): React.ReactNode {
	const changes = Array.isArray(event.changes)
		? (event.changes as Array<{
				path?: unknown;
				kind?: unknown;
				diff?: unknown;
				movePath?: unknown;
			}>)
		: [];
	return (
		<div className="rounded-xl border border-dark-800 bg-dark-900/30 px-4 py-3 text-xs leading-5">
			<div className="text-[10px] uppercase tracking-wide text-dark-500">
				File changes
			</div>
			<div className="mt-2 flex flex-col gap-2">
				{changes.map((change) => {
					const path = typeof change.path === "string" ? change.path : "?";
					const kind =
						typeof change.kind === "string" ? change.kind : "unknown";
					const diff = typeof change.diff === "string" ? change.diff : "";
					const movePath =
						typeof change.movePath === "string" ? change.movePath : undefined;
					return (
						<div
							key={`${kind}-${path}`}
							className="rounded bg-dark-950/60 px-2 py-2"
						>
							<div className="flex items-baseline gap-2">
								<span
									className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${kindClass(kind)}`}
								>
									{kind}
								</span>
								<span className="font-mono text-dark-100">{path}</span>
								{movePath && (
									<span className="font-mono text-dark-400">→ {movePath}</span>
								)}
							</div>
							{diff && (
								<pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-dark-200">
									{diff}
								</pre>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
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
