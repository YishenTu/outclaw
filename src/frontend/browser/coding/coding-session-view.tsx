import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
	UsageInfo,
	WorkspaceFileEntry,
} from "../../../common/protocol.ts";
import { MessageInput } from "../components/chat/composer/message-input.tsx";
import { ThinkingIndicator } from "../components/chat/thinking-indicator.tsx";
import {
	type CodingSessionEventStreamItem,
	fetchCodingRepositorySkills,
	fetchCodingRepositoryWorkspaceFiles,
	openCodingSessionEventStream,
	resumeCodingSession,
	startCodingSession,
	stopCodingSession,
} from "../lib/api.ts";
import { useContextUsageStore } from "../stores/context-usage.ts";
import type { CommandEntry } from "../stores/slash-commands.ts";
import {
	CodingEventView,
	isCodingTurnInFlight,
} from "./coding-event-renderer.tsx";
import { CodingModelSelector } from "./coding-model-selector.tsx";
import {
	appendCodingSessionEventBatch,
	codingSessionEventCache,
} from "./coding-session-event-cache.ts";
import { buildCodingSkillCommands } from "./coding-skill-commands.ts";
import { useCodingStore } from "./coding-store.ts";

const EMPTY_MENTION_FILES: WorkspaceFileEntry[] = [];

interface CodingSessionViewProps {
	repository: BrowserCodingRepositorySummary | undefined;
	session: BrowserCodingSessionSummary | undefined;
	onSessionStarted(repositoryId: string, summary: PartialSessionSummary): void;
}

export interface PartialSessionSummary {
	providerId: string;
	sdkSessionId: string;
}

export function CodingSessionView({
	repository,
	session,
	onSessionStarted,
}: CodingSessionViewProps) {
	if (!repository) {
		return (
			<EmptyShell message="Select a repository to start a coding session." />
		);
	}

	if (!session) {
		return (
			<NewSessionPanel
				repository={repository}
				onStarted={(summary) => onSessionStarted(repository.id, summary)}
			/>
		);
	}

	return <ActiveSessionPanel repository={repository} session={session} />;
}

function EmptyShell({ message }: { message: string }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col bg-dark-950">
			<HeaderBar leading={null} title={null} />
			<div className="flex flex-1 items-center justify-center px-6">
				<div className="border border-dashed border-dark-800 px-6 py-5 text-center">
					<div className="font-mono-ui text-[12px] uppercase tracking-[0.18em] text-dark-500">
						No coding session
					</div>
					<div className="mt-3 max-w-md text-sm text-dark-400">{message}</div>
				</div>
			</div>
		</div>
	);
}

function HeaderBar({
	leading,
	title,
}: {
	leading: string | null;
	title: string | null;
}) {
	return (
		<div className="h-8 shrink-0 border-b border-dark-800 px-6">
			<div className="mx-auto flex h-full max-w-4xl items-center gap-4">
				{(leading || title) && (
					<div className="min-w-0 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
						{leading && (
							<span className="truncate text-parchment">{leading}</span>
						)}
						{leading && title && <span className="px-2 text-dark-700">/</span>}
						{title && <span className="truncate">{title}</span>}
					</div>
				)}
			</div>
		</div>
	);
}

function resolvePriorityServiceTier(
	models: { id: string; serviceTiers: { id: string }[] }[],
	modelId: string | undefined,
): string | undefined {
	if (!modelId) {
		return undefined;
	}
	const model = models.find((entry) => entry.id === modelId);
	return model?.serviceTiers?.[0]?.id;
}

function readUsageFromEvent(event: unknown): UsageInfo | undefined {
	if (!event || typeof event !== "object") {
		return undefined;
	}
	const record = event as Record<string, unknown>;
	if (record.type === "usage_updated") {
		return record.usage as UsageInfo | undefined;
	}
	if (record.type === "done") {
		return record.usage as UsageInfo | undefined;
	}
	return undefined;
}

type CodingSkillCommandStatus = "loading" | "ready" | "error";

interface CodingSkillCommandCatalog {
	commands: CommandEntry[];
	emptyMessage: string;
}

function useCodingSkillCommands(
	repositoryId: string,
): CodingSkillCommandCatalog {
	const [commands, setCommands] = useState<CommandEntry[]>([]);
	const [status, setStatus] = useState<CodingSkillCommandStatus>("loading");

	useEffect(() => {
		let cancelled = false;
		setCommands([]);
		setStatus("loading");
		void fetchCodingRepositorySkills(repositoryId)
			.then((response) => {
				if (!cancelled) {
					setCommands(buildCodingSkillCommands(response.skills));
					setStatus("ready");
				}
			})
			.catch(() => {
				if (!cancelled) {
					setCommands([]);
					setStatus("error");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [repositoryId]);

	return {
		commands,
		emptyMessage: resolveCodingSkillEmptyMessage(status, commands.length),
	};
}

function resolveCodingSkillEmptyMessage(
	status: CodingSkillCommandStatus,
	commandCount: number,
): string {
	if (status === "loading") {
		return "Loading coding skills...";
	}
	if (status === "error") {
		return "Unable to load coding skills";
	}
	return commandCount === 0
		? "No coding skills found"
		: "No matching coding skills";
}

function useCodingRepositoryMentionFiles(repositoryId: string): {
	files: WorkspaceFileEntry[];
	requestFiles: () => void;
} {
	const [entry, setEntry] = useState<
		{ repositoryId: string; files: WorkspaceFileEntry[] } | undefined
	>();
	const [loadingRepositoryId, setLoadingRepositoryId] = useState<
		string | undefined
	>();
	const requestFiles = useCallback(() => {
		if (entry?.repositoryId === repositoryId) {
			return;
		}
		if (loadingRepositoryId === repositoryId) {
			return;
		}
		setLoadingRepositoryId(repositoryId);
		void fetchCodingRepositoryWorkspaceFiles(repositoryId)
			.then((files) => {
				setEntry({ repositoryId, files });
			})
			.catch(() => {
				setEntry({ repositoryId, files: EMPTY_MENTION_FILES });
			})
			.finally(() => {
				setLoadingRepositoryId((current) =>
					current === repositoryId ? undefined : current,
				);
			});
	}, [entry?.repositoryId, loadingRepositoryId, repositoryId]);

	return {
		files:
			entry?.repositoryId === repositoryId ? entry.files : EMPTY_MENTION_FILES,
		requestFiles,
	};
}

function NewSessionPanel({
	repository,
	onStarted,
}: {
	repository: BrowserCodingRepositorySummary;
	onStarted(summary: PartialSessionSummary): void;
}) {
	const codingModels = useCodingStore((state) => state.codingModels);
	const selectedModelId = useCodingStore((state) => state.selectedModelId);
	const selectedEffort = useCodingStore((state) => state.selectedEffort);
	const fastTierEnabled = useCodingStore((state) => state.fastTierEnabled);
	const setSelectedModelId = useCodingStore(
		(state) => state.setSelectedModelId,
	);
	const setSelectedEffort = useCodingStore((state) => state.setSelectedEffort);
	const setFastTierEnabled = useCodingStore(
		(state) => state.setFastTierEnabled,
	);
	const skillCatalog = useCodingSkillCommands(repository.id);
	const mentionFiles = useCodingRepositoryMentionFiles(repository.id);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>();

	const onSend = useCallback(
		async ({ text }: { text: string }): Promise<boolean> => {
			const trimmed = text.trim();
			if (!trimmed || submitting) {
				return false;
			}
			setSubmitting(true);
			setError(undefined);
			try {
				const serviceTier = fastTierEnabled
					? resolvePriorityServiceTier(codingModels, selectedModelId)
					: undefined;
				const result = await startCodingSession({
					repositoryId: repository.id,
					prompt: trimmed,
					...(selectedModelId ? { model: selectedModelId } : {}),
					...(selectedEffort ? { effort: selectedEffort } : {}),
					...(serviceTier ? { serviceTier } : {}),
				});
				if (result.status === "rejected") {
					setError(result.message);
					return false;
				}
				onStarted({
					providerId: result.providerId,
					sdkSessionId: result.sdkSessionId,
				});
				return true;
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
				return false;
			} finally {
				setSubmitting(false);
			}
		},
		[
			codingModels,
			fastTierEnabled,
			onStarted,
			repository.id,
			selectedEffort,
			selectedModelId,
			submitting,
		],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-dark-950">
			<HeaderBar leading={repository.displayName} title="New session" />
			<div className="scrollbar-none flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
				{error && (
					<div className="mx-auto w-full max-w-4xl px-4 pt-4">
						<div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">
							{error}
						</div>
					</div>
				)}
			</div>
			<MessageInput
				onSend={onSend}
				model={null}
				effort={null}
				onModelChange={() => false}
				onEffortChange={() => false}
				disabled={submitting}
				interruptible={false}
				attachmentsEnabled={false}
				commandEntries={skillCatalog.commands}
				commandMenuEmptyMessage={skillCatalog.emptyMessage}
				commandTriggerChars={["/", "$"]}
				fileMentionEntries={mentionFiles.files}
				onFileMentionEntriesRequested={mentionFiles.requestFiles}
				modelSelectorSlot={
					<CodingModelSelector
						models={codingModels}
						selectedModelId={selectedModelId}
						selectedEffort={selectedEffort}
						fastTierEnabled={fastTierEnabled}
						disabled={submitting}
						onSelectModel={setSelectedModelId}
						onSelectEffort={setSelectedEffort}
						onToggleFastTier={setFastTierEnabled}
					/>
				}
			/>
		</div>
	);
}

function ActiveSessionPanel({
	repository,
	session,
}: {
	repository: BrowserCodingRepositorySummary;
	session: BrowserCodingSessionSummary;
}) {
	const codingModels = useCodingStore((state) => state.codingModels);
	const selectedModelId = useCodingStore((state) => state.selectedModelId);
	const selectedEffort = useCodingStore((state) => state.selectedEffort);
	const fastTierEnabled = useCodingStore((state) => state.fastTierEnabled);
	const setSelectedModelId = useCodingStore(
		(state) => state.setSelectedModelId,
	);
	const setSelectedEffort = useCodingStore((state) => state.setSelectedEffort);
	const setFastTierEnabled = useCodingStore(
		(state) => state.setFastTierEnabled,
	);
	const skillCatalog = useCodingSkillCommands(repository.id);
	const mentionFiles = useCodingRepositoryMentionFiles(repository.id);
	const [events, setEvents] = useState<CodingSessionEventStreamItem[]>([]);
	const [streamError, setStreamError] = useState<string | undefined>();
	const [submitting, setSubmitting] = useState(false);
	const [resumeError, setResumeError] = useState<string | undefined>();
	const scrollRef = useRef<HTMLDivElement>(null);
	const eventLengthRef = useRef(0);
	const usageSessionKey = `coding:${session.providerId}/${session.sdkSessionId}`;

	useEffect(() => {
		const cached = codingSessionEventCache.get(usageSessionKey);
		setEvents(cached?.events ?? []);
		setStreamError(undefined);
		eventLengthRef.current = 0;
		const pendingEvents: CodingSessionEventStreamItem[] = [];
		let frameId: number | undefined;
		let active = true;
		const flushPendingEventsToCache = (): CodingSessionEventStreamItem[] => {
			frameId = undefined;
			if (pendingEvents.length === 0) {
				return codingSessionEventCache.get(usageSessionKey)?.events ?? [];
			}
			const pending = pendingEvents.splice(0);
			const baseEvents =
				codingSessionEventCache.get(usageSessionKey)?.events ??
				cached?.events ??
				[];
			return appendCodingSessionEventBatch(
				codingSessionEventCache,
				usageSessionKey,
				baseEvents,
				pending,
				{ allowSequenceRestart: true },
			).events;
		};
		const flushPendingEvents = () => {
			frameId = undefined;
			if (pendingEvents.length === 0) {
				return;
			}
			if (!active) {
				flushPendingEventsToCache();
				return;
			}
			const pending = pendingEvents.splice(0);
			setEvents((prev) => {
				return appendCodingSessionEventBatch(
					codingSessionEventCache,
					usageSessionKey,
					prev,
					pending,
					{ allowSequenceRestart: true },
				).events;
			});
		};
		const scheduleFlush = () => {
			if (frameId !== undefined) {
				return;
			}
			if (typeof window === "undefined") {
				frameId = setTimeout(flushPendingEvents, 16) as unknown as number;
				return;
			}
			frameId = window.requestAnimationFrame(flushPendingEvents);
		};
		const close = openCodingSessionEventStream({
			providerId: session.providerId,
			sdkSessionId: session.sdkSessionId,
			// Stream sequences are scoped to one replay/follow subscription; provider
			// history is re-numbered on the next open, so cached cursors cannot skip it.
			onEvent: (item) => {
				if (!active) {
					return;
				}
				// Codex emits `thread/tokenUsage/updated` mid-turn; the adapter
				// surfaces it as a `usage_updated` FacadeEvent. The `done` event
				// also carries the final usage. Push either snapshot into the
				// shared usage store so the input's ContextGauge ticks live.
				const usageInfo = readUsageFromEvent(item.event);
				if (usageInfo) {
					useContextUsageStore.getState().setUsage(usageSessionKey, usageInfo);
				}
				pendingEvents.push(item);
				scheduleFlush();
			},
			onError: (message) => {
				if (active) {
					setStreamError(message);
				}
			},
		});
		return () => {
			active = false;
			if (frameId !== undefined) {
				if (typeof window === "undefined") {
					clearTimeout(frameId);
				} else {
					window.cancelAnimationFrame(frameId);
				}
				flushPendingEventsToCache();
			}
			close();
		};
	}, [session.providerId, session.sdkSessionId, usageSessionKey]);

	useEffect(() => {
		if (!scrollRef.current) {
			return;
		}
		if (events.length === eventLengthRef.current) {
			return;
		}
		eventLengthRef.current = events.length;
		scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
	}, [events]);

	const onSend = useCallback(
		async ({ text }: { text: string }): Promise<boolean> => {
			const trimmed = text.trim();
			if (!trimmed || submitting) {
				return false;
			}
			setSubmitting(true);
			setResumeError(undefined);
			try {
				const serviceTier = fastTierEnabled
					? resolvePriorityServiceTier(codingModels, selectedModelId)
					: undefined;
				const result = await resumeCodingSession({
					providerId: session.providerId,
					sdkSessionId: session.sdkSessionId,
					prompt: trimmed,
					...(selectedModelId ? { model: selectedModelId } : {}),
					...(selectedEffort ? { effort: selectedEffort } : {}),
					...(serviceTier ? { serviceTier } : {}),
				});
				if (result.status === "rejected") {
					setResumeError(result.message);
					return false;
				}
				return true;
			} catch (err) {
				setResumeError(err instanceof Error ? err.message : String(err));
				return false;
			} finally {
				setSubmitting(false);
			}
		},
		[
			codingModels,
			fastTierEnabled,
			selectedEffort,
			selectedModelId,
			session.providerId,
			session.sdkSessionId,
			submitting,
		],
	);

	const onInterrupt = useCallback((): boolean => {
		setResumeError(undefined);
		void stopCodingSession({
			providerId: session.providerId,
			sdkSessionId: session.sdkSessionId,
		})
			.then((result) => {
				if (result.status === "rejected") {
					setResumeError(result.message);
				}
			})
			.catch((err) => {
				setResumeError(err instanceof Error ? err.message : String(err));
			});
		return true;
	}, [session.providerId, session.sdkSessionId]);

	const title = session.title || session.sdkSessionId;
	// Prefer the live event log so the spinner hides as soon as a terminal event
	// arrives. Use the cached runStatus only before replay delivers any events.
	const turnInFlight = useMemo(() => isCodingTurnInFlight(events), [events]);
	const isRunning =
		turnInFlight || (events.length === 0 && session.runStatus === "running");

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-dark-950">
			<HeaderBar leading={repository.displayName} title={title} />
			{resumeError && (
				<div className="border-b border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
					<div className="mx-auto max-w-4xl">{resumeError}</div>
				</div>
			)}
			<div
				ref={scrollRef}
				className="scrollbar-none flex-1 overflow-y-auto overflow-x-hidden"
			>
				<div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
					<CodingEventView events={events} />
					{isRunning && (
						<ThinkingIndicator startedAt={null} isWorking={events.length > 0} />
					)}
					{streamError && (
						<div className="text-xs text-danger">{streamError}</div>
					)}
				</div>
			</div>
			<MessageInput
				onSend={onSend}
				model={null}
				effort={null}
				onModelChange={() => false}
				onEffortChange={() => false}
				disabled={submitting}
				interruptible={isRunning}
				onInterrupt={onInterrupt}
				sessionKey={usageSessionKey}
				attachmentsEnabled={false}
				commandEntries={skillCatalog.commands}
				commandMenuEmptyMessage={skillCatalog.emptyMessage}
				commandTriggerChars={["/", "$"]}
				fileMentionEntries={mentionFiles.files}
				onFileMentionEntriesRequested={mentionFiles.requestFiles}
				modelSelectorSlot={
					<CodingModelSelector
						models={codingModels}
						selectedModelId={selectedModelId}
						selectedEffort={selectedEffort}
						fastTierEnabled={fastTierEnabled}
						disabled={submitting}
						onSelectModel={setSelectedModelId}
						onSelectEffort={setSelectedEffort}
						onToggleFastTier={setFastTierEnabled}
					/>
				}
			/>
		</div>
	);
}
