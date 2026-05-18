import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCronJobFile } from "../../../../common/cron-job-file.ts";
import type {
	BrowserCronEntry,
	BrowserCronHistoryCursor,
	BrowserCronRunEntry,
	BrowserTreeEntry,
} from "../../../../common/protocol.ts";
import {
	fetchAgentCron,
	fetchAgentCronHistory,
	updateAgentCronEnabled,
} from "../../lib/api.ts";
import { useRightPanelRefreshStore } from "../../stores/right-panel-refresh.ts";
import { MarkdownContent } from "../transcript/markdown-content.tsx";

const CRON_TABLE_COLUMNS =
	"grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto]" as const;
const CRON_ROW_COLUMNS = "grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)]" as const;
const CRON_HISTORY_LOAD_MORE_LIMIT = 3;

interface CronPanelProps {
	agentId: string;
	treeEntries?: BrowserTreeEntry[];
}

interface CronHistoryState {
	entries: BrowserCronRunEntry[];
	hasMore: boolean;
	loading: boolean;
	error: string | null;
}

const EMPTY_HISTORY: CronHistoryState = {
	entries: [],
	hasMore: false,
	loading: false,
	error: null,
};

export function CronPanelHeader() {
	return (
		<div className="h-8 shrink-0 border-b border-dark-800 px-3">
			<div
				className={`grid ${CRON_TABLE_COLUMNS} h-full items-center gap-3 px-2 font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500`}
			>
				<div className="pl-[22px]">Cron</div>
				<div>Frequency</div>
				<div className="w-7 -translate-x-2 justify-self-center text-center">
					On/Off
				</div>
			</div>
		</div>
	);
}

export function humanizeCronSchedule(
	schedule: string,
	timezone?: string,
): string {
	const parts = schedule.trim().split(/\s+/);
	if (parts.length !== 5) {
		return appendCronTimezone(schedule, timezone);
	}

	const minute = parts[0];
	const hour = parts[1];
	const dayOfMonth = parts[2];
	const month = parts[3];
	const dayOfWeek = parts[4];
	if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
		return appendCronTimezone(schedule, timezone);
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\*\/\d+$/.test(minute) &&
		hour === "*"
	) {
		return appendCronTimezone(`Every ${minute.slice(2)} min`, timezone);
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		hour === "*"
	) {
		return appendCronTimezone(`Hourly :${minute.padStart(2, "0")}`, timezone);
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		/^\*\/\d+$/.test(hour)
	) {
		return appendCronTimezone(`Every ${hour.slice(2)} hr`, timezone);
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return appendCronTimezone(
			`Daily ${formatCronTime(hour, minute)}`,
			timezone,
		);
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "1-5" &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return appendCronTimezone(
			`Weekdays ${formatCronTime(hour, minute)}`,
			timezone,
		);
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		isCronDayOfWeekList(dayOfWeek) &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return appendCronTimezone(
			`${formatCompactCronTime(hour, minute)} ${formatCronDayOfWeekList(dayOfWeek)}`,
			timezone,
		);
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		isCronDayOfWeek(dayOfWeek) &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return appendCronTimezone(
			`Weekly ${formatCronDayOfWeek(dayOfWeek)} ${formatCronTime(hour, minute)}`,
			timezone,
		);
	}

	if (
		isCronDayOfMonth(dayOfMonth) &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return appendCronTimezone(
			`Monthly day ${dayOfMonth} ${formatCronTime(hour, minute)}`,
			timezone,
		);
	}

	return appendCronTimezone(schedule, timezone);
}

export function humanizeCronEntrySchedule(entry: BrowserCronEntry): string {
	if (entry.scheduleKind !== "once") {
		return humanizeCronSchedule(entry.schedule, entry.timezone);
	}

	const runAt = entry.runAt ?? entry.schedule;
	const formattedRunAt = formatRunAt(runAt);
	const prefix = entry.status === "expired" ? "Expired" : "Once";
	return `${prefix} ${formattedRunAt}`;
}

function appendCronTimezone(label: string, timezone?: string): string {
	const normalizedTimezone = timezone?.trim().toUpperCase();
	return normalizedTimezone ? `${label} (${normalizedTimezone})` : label;
}

function formatRunAt(runAt: string): string {
	const match = runAt
		.trim()
		.match(
			/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/,
		);
	if (!match) {
		return runAt;
	}

	const [, date, time, offset] = match;
	return `${date} ${time} ${formatIsoOffset(offset ?? "Z")}`;
}

function formatIsoOffset(offset: string): string {
	if (offset === "Z" || offset === "+00:00" || offset === "-00:00") {
		return "UTC";
	}

	const sign = offset.slice(0, 1);
	const [hours = "", minutes = ""] = offset.slice(1).split(":");
	const normalizedHours = String(Number.parseInt(hours, 10));
	return minutes === "00"
		? `UTC${sign}${normalizedHours}`
		: `UTC${sign}${normalizedHours}:${minutes}`;
}

function formatCronTime(hour: string, minute: string): string {
	return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function formatCompactCronTime(hour: string, minute: string): string {
	return `${Number.parseInt(hour, 10)}:${minute.padStart(2, "0")}`;
}

function isCronDayOfWeek(value: string): boolean {
	return /^(0|1|2|3|4|5|6|7)$/.test(value);
}

function isCronDayOfWeekList(value: string): boolean {
	const days = value.split(",");
	return days.length > 1 && days.every(isCronDayOfWeek);
}

function formatCronDayOfWeekList(value: string): string {
	return value.split(",").map(formatCronDayOfWeekListItem).join("/");
}

function formatCronDayOfWeekListItem(value: string): string {
	if (value === "4") {
		return "Thur";
	}

	return formatCronDayOfWeek(value);
}

function formatCronDayOfWeek(value: string): string {
	switch (value) {
		case "0":
		case "7":
			return "Sun";
		case "1":
			return "Mon";
		case "2":
			return "Tue";
		case "3":
			return "Wed";
		case "4":
			return "Thu";
		case "5":
			return "Fri";
		case "6":
			return "Sat";
		default:
			return value;
	}
}

function isCronDayOfMonth(value: string): boolean {
	return /^(?:[1-9]|[12]\d|3[01])$/.test(value);
}

export function buildFallbackCronEntries(
	treeEntries: BrowserTreeEntry[] | undefined,
): BrowserCronEntry[] {
	const cronDirectory = treeEntries?.find(
		(entry) => entry.kind === "directory" && entry.path === "cron",
	);
	return (
		cronDirectory?.children
			?.filter((entry) => entry.kind === "file" && isCronJobFile(entry.path))
			.map((entry) => ({
				name: entry.name,
				path: entry.path,
				schedule: "Schedule unavailable",
				scheduleKind: "recurring" as const,
				enabled: true,
				status: "scheduled" as const,
			})) ?? []
	);
}

export function CronPanel({ agentId, treeEntries }: CronPanelProps) {
	const cronRevision = useRightPanelRefreshStore(
		(state) => state.cronRevisionByAgent[agentId] ?? 0,
	);
	const [entries, setEntries] = useState<BrowserCronEntry[]>([]);
	const [pendingPaths, setPendingPaths] = useState<Record<string, boolean>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [mutationError, setMutationError] = useState<string | null>(null);
	const [expandedPath, setExpandedPath] = useState<string | null>(null);
	const [historyByName, setHistoryByName] = useState<
		Record<string, CronHistoryState>
	>({});
	const historyAgentRef = useRef(agentId);
	historyAgentRef.current = agentId;
	const lastHistoryRefreshRevisionRef = useRef(cronRevision);
	const fallbackEntries = useMemo(
		() => buildFallbackCronEntries(treeEntries),
		[treeEntries],
	);
	const visibleEntries = useMemo(
		() =>
			(entries.length > 0 ? entries : error ? fallbackEntries : entries).filter(
				(entry) => isCronJobFile(entry.path),
			),
		[entries, error, fallbackEntries],
	);

	const loadHistoryPage = useCallback(
		(jobName: string, before?: BrowserCronHistoryCursor) => {
			const requestAgentId = agentId;
			const limit = before === undefined ? 1 : CRON_HISTORY_LOAD_MORE_LIMIT;
			setHistoryByName((current) => ({
				...current,
				[jobName]: {
					...(current[jobName] ?? EMPTY_HISTORY),
					loading: true,
					error: null,
				},
			}));
			void fetchAgentCronHistory(agentId, { jobName, limit, before })
				.then((response) => {
					if (historyAgentRef.current !== requestAgentId) {
						return;
					}
					setHistoryByName((current) => {
						const previous = current[jobName] ?? EMPTY_HISTORY;
						const merged = mergeCronHistoryEntries(
							previous.entries,
							response.entries,
						);
						return {
							...current,
							[jobName]: {
								entries: merged,
								hasMore: response.hasMore,
								loading: false,
								error: null,
							},
						};
					});
				})
				.catch((nextError) => {
					if (historyAgentRef.current !== requestAgentId) {
						return;
					}
					setHistoryByName((current) => ({
						...current,
						[jobName]: {
							...(current[jobName] ?? EMPTY_HISTORY),
							loading: false,
							error:
								nextError instanceof Error
									? nextError.message
									: "Failed to load cron history",
						},
					}));
				});
		},
		[agentId],
	);

	const handleToggleExpand = useCallback(
		(entry: BrowserCronEntry) => {
			setExpandedPath((current) => {
				if (current === entry.path) {
					return null;
				}
				if (!historyByName[entry.name]) {
					loadHistoryPage(entry.name);
				}
				return entry.path;
			});
		},
		[historyByName, loadHistoryPage],
	);

	useEffect(() => {
		historyAgentRef.current = agentId;
		setExpandedPath(null);
		setHistoryByName({});
		setPendingPaths({});
	}, [agentId]);

	useEffect(() => {
		void cronRevision;

		let cancelled = false;
		setMutationError(null);
		setLoading(true);
		setError(null);
		void fetchAgentCron(agentId)
			.then((nextEntries) => {
				if (!cancelled) {
					setEntries(nextEntries);
					setError(null);
				}
			})
			.catch((nextError) => {
				if (!cancelled) {
					setEntries(fallbackEntries);
					setError(
						nextError instanceof Error
							? nextError.message
							: "Failed to load cron jobs",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [agentId, cronRevision, fallbackEntries]);

	useEffect(() => {
		if (lastHistoryRefreshRevisionRef.current === cronRevision) {
			return;
		}
		lastHistoryRefreshRevisionRef.current = cronRevision;
		if (!expandedPath) {
			return;
		}
		const expandedEntry = visibleEntries.find(
			(entry) => entry.path === expandedPath,
		);
		if (!expandedEntry) {
			return;
		}
		loadHistoryPage(expandedEntry.name);
	}, [cronRevision, expandedPath, loadHistoryPage, visibleEntries]);

	if (loading) {
		return (
			<div className="px-4 py-4 text-sm text-dark-500">Loading cron jobs…</div>
		);
	}

	if (error && fallbackEntries.length === 0) {
		return <div className="px-4 py-4 text-sm text-danger">{error}</div>;
	}

	if (visibleEntries.length === 0) {
		return (
			<div className="px-4 py-4 text-sm text-dark-500">
				No cron jobs found for this agent.
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<CronPanelHeader />
			<div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-3">
				{error ? (
					<div className="px-2 py-2 text-xs text-danger">{error}</div>
				) : null}
				{mutationError ? (
					<div className="px-2 py-2 text-xs text-danger">{mutationError}</div>
				) : null}
				{visibleEntries.map((entry) => (
					<div
						key={entry.path}
						className="border-t border-dark-900 first:border-t-0"
					>
						<div
							className={`grid ${CRON_TABLE_COLUMNS} items-center gap-3 rounded px-2 py-2.5 text-sm text-dark-400 transition-colors hover:text-dark-200`}
						>
							<button
								type="button"
								onClick={() => handleToggleExpand(entry)}
								className={`col-span-2 grid min-w-0 ${CRON_ROW_COLUMNS} items-center gap-3 text-left`}
								aria-expanded={expandedPath === entry.path}
							>
								<div className="flex min-w-0 items-center gap-2 text-dark-200">
									{expandedPath === entry.path ? (
										<ChevronDown size={14} className="shrink-0 text-dark-500" />
									) : (
										<ChevronRight
											size={14}
											className="shrink-0 text-dark-500"
										/>
									)}
									<span className="truncate">{entry.name}</span>
								</div>
								<div className="truncate text-xs text-dark-500">
									{humanizeCronEntrySchedule(entry)}
								</div>
							</button>
							<button
								type="button"
								onClick={() => {
									setMutationError(null);
									setPendingPaths((current) => ({
										...current,
										[entry.path]: true,
									}));
									void updateAgentCronEnabled(
										agentId,
										entry.path,
										!entry.enabled,
									)
										.then((nextEntry) => {
											setEntries((current) =>
												current.map((currentEntry) =>
													currentEntry.path === nextEntry.path
														? {
																...currentEntry,
																...nextEntry,
																error: undefined,
															}
														: currentEntry,
												),
											);
										})
										.catch((nextError) => {
											setMutationError(
												nextError instanceof Error
													? nextError.message
													: "Failed to update cron job",
											);
										})
										.finally(() => {
											setPendingPaths((current) => ({
												...current,
												[entry.path]: false,
											}));
										});
								}}
								disabled={
									pendingPaths[entry.path] === true || entry.error !== undefined
								}
								className="w-7 justify-self-center"
								aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name}`}
							>
								<div
									aria-hidden="true"
									className={`relative h-4 w-7 rounded-full transition-colors ${
										entry.enabled ? "bg-success/30" : "bg-dark-700"
									} ${pendingPaths[entry.path] ? "opacity-60" : ""}`}
								>
									<div
										className={`absolute top-0.5 h-3 w-3 rounded-full transition-transform ${
											entry.enabled ? "bg-success" : "bg-dark-300"
										} ${entry.enabled ? "translate-x-3.5" : "translate-x-0.5"}`}
									/>
								</div>
							</button>
						</div>
						{entry.error ? (
							<div className="px-2 pb-2 text-xs text-danger">{entry.error}</div>
						) : null}
						{expandedPath === entry.path ? (
							<CronHistoryList
								history={historyByName[entry.name] ?? EMPTY_HISTORY}
								onLoadMore={() => {
									const oldest = historyByName[entry.name]?.entries.at(-1);
									loadHistoryPage(entry.name, oldest);
								}}
							/>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}

export function CronHistoryList({
	history,
	onLoadMore,
}: {
	history: CronHistoryState;
	onLoadMore: () => void;
}) {
	const initialFirstRun = history.entries.at(0);
	const initialFirstRunKey = initialFirstRun
		? getCronRunKey(initialFirstRun)
		: null;
	const autoExpandedFirstRunKeyRef = useRef<string | null>(initialFirstRunKey);
	const [expandedRunKeys, setExpandedRunKeys] = useState<Set<string>>(
		() => new Set(initialFirstRunKey ? [initialFirstRunKey] : []),
	);

	useEffect(() => {
		setExpandedRunKeys((current) => {
			const next = reconcileCronHistoryExpansion(
				{
					autoExpandedFirstKey: autoExpandedFirstRunKeyRef.current,
					expandedKeys: [...current],
				},
				history.entries,
			);
			autoExpandedFirstRunKeyRef.current = next.autoExpandedFirstKey;
			if (sameStringSet(current, next.expandedKeys)) {
				return current;
			}
			return new Set(next.expandedKeys);
		});
	}, [history.entries]);

	const handleToggleRun = useCallback((entry: BrowserCronRunEntry) => {
		const key = getCronRunKey(entry);
		setExpandedRunKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}, []);

	if (history.loading && history.entries.length === 0) {
		return (
			<div className="px-2 pb-3 text-xs text-dark-500">Loading history…</div>
		);
	}

	if (history.error && history.entries.length === 0) {
		return <div className="px-2 pb-3 text-xs text-danger">{history.error}</div>;
	}

	if (history.entries.length === 0) {
		return <div className="px-2 pb-3 text-xs text-dark-500">No runs yet.</div>;
	}

	return (
		<div className="space-y-2 px-2 pb-3">
			{history.entries.map((entry) => {
				const key = getCronRunKey(entry);
				const isExpanded = expandedRunKeys.has(key);
				const timestamp = formatHistoryTimestamp(entry.ranAt);
				return (
					<div
						key={key}
						className="rounded border border-dark-800 bg-dark-950 px-3 py-2"
					>
						<button
							type="button"
							onClick={() => handleToggleRun(entry)}
							aria-expanded={isExpanded}
							aria-label={`${isExpanded ? "Collapse" : "Expand"} cron run ${timestamp}`}
							className="flex w-full items-center gap-2 text-left"
						>
							{isExpanded ? (
								<ChevronDown size={12} className="shrink-0 text-dark-500" />
							) : (
								<ChevronRight size={12} className="shrink-0 text-dark-500" />
							)}
							<span className="font-mono-ui text-[11px] uppercase tracking-[0.14em] text-dark-500">
								{timestamp}
							</span>
						</button>
						{isExpanded ? (
							<div className="mt-2 pl-5">
								{entry.resultText.trim() === "" ? (
									<div className="whitespace-pre-wrap break-words font-mono-ui text-xs text-dark-400">
										(no output)
									</div>
								) : (
									<MarkdownContent content={entry.resultText} />
								)}
							</div>
						) : null}
					</div>
				);
			})}
			{history.error ? (
				<div className="text-xs text-danger">{history.error}</div>
			) : null}
			{history.hasMore ? (
				<button
					type="button"
					onClick={onLoadMore}
					disabled={history.loading}
					className="w-full rounded border border-dark-800 px-2 py-1.5 text-xs text-dark-300 hover:bg-dark-900 disabled:opacity-50"
				>
					{history.loading ? "Loading…" : "Load more"}
				</button>
			) : null}
		</div>
	);
}

interface CronHistoryExpansionState {
	autoExpandedFirstKey: string | null;
	expandedKeys: string[];
}

export function reconcileCronHistoryExpansion(
	state: CronHistoryExpansionState,
	entries: BrowserCronRunEntry[],
): CronHistoryExpansionState {
	const entryKeys = entries.map(getCronRunKey);
	const validKeys = new Set(entryKeys);
	const expandedKeys = state.expandedKeys.filter((key) => validKeys.has(key));
	const firstKey = entryKeys[0] ?? null;

	if (firstKey && state.autoExpandedFirstKey !== firstKey) {
		expandedKeys.push(firstKey);
	}

	return {
		autoExpandedFirstKey: firstKey,
		expandedKeys: Array.from(new Set(expandedKeys)),
	};
}

export function mergeCronHistoryEntries(
	currentEntries: BrowserCronRunEntry[],
	incomingEntries: BrowserCronRunEntry[],
): BrowserCronRunEntry[] {
	const seen = new Set<string>();
	const result: BrowserCronRunEntry[] = [];
	for (const entry of [...currentEntries, ...incomingEntries]) {
		const key = getCronRunKey(entry);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(entry);
	}
	return result.sort(compareCronRunEntries);
}

function compareCronRunEntries(
	left: BrowserCronRunEntry,
	right: BrowserCronRunEntry,
): number {
	if (left.ranAt !== right.ranAt) {
		return right.ranAt - left.ranAt;
	}
	const providerOrder = right.providerId.localeCompare(left.providerId);
	if (providerOrder !== 0) {
		return providerOrder;
	}
	return right.sessionId.localeCompare(left.sessionId);
}

function sameStringSet(left: Set<string>, right: string[]): boolean {
	if (left.size !== right.length) {
		return false;
	}
	return right.every((value) => left.has(value));
}

function getCronRunKey(entry: BrowserCronRunEntry): string {
	return `${entry.providerId}:${entry.sessionId}`;
}

export function formatHistoryTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return String(timestamp);
	}
	const time = date.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
	const day = date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
	const year = date.toLocaleDateString(undefined, {
		year: "numeric",
	});
	return `${time}, ${day}, ${year}`;
}
