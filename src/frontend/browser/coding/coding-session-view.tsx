import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
	UsageInfo,
	WorkspaceFileEntry,
} from "../../../common/protocol.ts";
import { CenterPanelBreadcrumb } from "../components/center/center-panel-breadcrumb.tsx";
import { MessageInput } from "../components/chat/composer/message-input.tsx";
import type { TranscriptItem } from "../components/transcript/transcript-items.ts";
import { TranscriptSurface } from "../components/transcript/transcript-surface.tsx";
import {
	type CodingSessionEventStreamItem,
	fetchCodingRepositorySkills,
	fetchCodingRepositoryWorkspaceFiles,
	fetchCodingSession,
	resumeCodingSession,
	startCodingSession,
	stopCodingSession,
} from "../lib/api.ts";
import { useContextUsageStore } from "../stores/context-usage.ts";
import type { CommandEntry } from "../stores/slash-commands.ts";
import {
	type CodingTranscriptProjection,
	isCodingTurnInFlight,
	projectCodingTranscriptEvents,
} from "./coding-event-renderer.tsx";
import { CodingModelSelector } from "./coding-model-selector.tsx";
import {
	codingSessionEventCacheKey,
	hydrateCodingSessionCachedEvents,
	readCodingSessionCachedEvents,
	subscribeCodingSessionCachedEvents,
} from "./coding-session-event-cache.ts";
import { shouldHydrateCodingSessionEvents } from "./coding-session-hydration.ts";
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
	prompt?: string;
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
			<div className="flex h-full max-w-4xl items-center gap-4">
				<CenterPanelBreadcrumb leading={leading} title={title} />
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
					prompt: trimmed,
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

export function ActiveSessionPanel({
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
	const usageSessionKey = codingSessionEventCacheKey({
		providerId: session.providerId,
		sdkSessionId: session.sdkSessionId,
	});

	useEffect(() => {
		const syncEvents = () => {
			setEvents(readCodingSessionCachedEvents(usageSessionKey));
		};
		const cachedEvents = readCodingSessionCachedEvents(usageSessionKey);
		setEvents(cachedEvents);
		setStreamError(undefined);
		let active = true;
		const unsubscribe = subscribeCodingSessionCachedEvents(
			usageSessionKey,
			syncEvents,
		);
		if (
			!shouldHydrateCodingSessionEvents({
				cachedEventCount: cachedEvents.length,
				runStatus: session.runStatus,
			})
		) {
			return () => {
				active = false;
				unsubscribe();
			};
		}
		void fetchCodingSession(session.providerId, session.sdkSessionId)
			.then((detail) => {
				if (!active || !detail.events) {
					return;
				}
				for (const item of detail.events) {
					const usageInfo = readUsageFromEvent(item.event);
					if (usageInfo) {
						useContextUsageStore
							.getState()
							.setUsage(usageSessionKey, usageInfo);
					}
				}
				hydrateCodingSessionCachedEvents(usageSessionKey, detail.events);
				syncEvents();
			})
			.catch((err) => {
				if (active) {
					setStreamError(err instanceof Error ? err.message : String(err));
				}
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [
		session.providerId,
		session.runStatus,
		session.sdkSessionId,
		usageSessionKey,
	]);

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
	const transcriptProjectionRef = useRef<
		CodingTranscriptProjection | undefined
	>(undefined);
	const transcriptItems = useMemo((): TranscriptItem[] => {
		const projection = projectCodingTranscriptEvents(
			transcriptProjectionRef.current,
			events,
		);
		transcriptProjectionRef.current = projection;
		const items = [...projection.items];
		if (isRunning) {
			items.push({
				kind: "activity",
				key: "coding-activity",
				startedAt: null,
				isWorking: events.length > 0,
				scrollKey: `coding-activity:${events.length > 0 ? "working" : "thinking"}`,
			});
		}
		if (streamError) {
			items.push({
				kind: "error",
				key: "coding-stream-error",
				message: streamError,
				scrollKey: `coding-stream-error:${streamError}`,
			});
		}
		return items;
	}, [events, isRunning, streamError]);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col bg-dark-950">
			<HeaderBar leading={repository.displayName} title={title} />
			{resumeError && (
				<div className="border-b border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
					<div className="mx-auto max-w-4xl">{resumeError}</div>
				</div>
			)}
			<TranscriptSurface
				sessionKey={usageSessionKey}
				items={transcriptItems}
				emptyMessage="No turn output yet. Send a prompt to start."
			/>
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
