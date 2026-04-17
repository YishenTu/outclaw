import { Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
	BrowserCronEntry,
	BrowserTreeEntry,
} from "../../../../common/protocol.ts";
import { fetchAgentCron, updateAgentCronEnabled } from "../../lib/api.ts";
import { useRightPanelRefreshStore } from "../../stores/right-panel-refresh.ts";

const CRON_TABLE_COLUMNS =
	"grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto]" as const;
const CRON_ROW_COLUMNS = "grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)]" as const;

interface CronPanelProps {
	agentId: string;
	treeEntries?: BrowserTreeEntry[];
	onOpenFile: (params: { agentId: string; path: string }) => void;
}

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

export function humanizeCronSchedule(schedule: string): string {
	const parts = schedule.trim().split(/\s+/);
	if (parts.length !== 5) {
		return schedule;
	}

	const minute = parts[0];
	const hour = parts[1];
	const dayOfMonth = parts[2];
	const month = parts[3];
	const dayOfWeek = parts[4];
	if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
		return schedule;
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\*\/\d+$/.test(minute) &&
		hour === "*"
	) {
		return `Every ${minute.slice(2)} min`;
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		hour === "*"
	) {
		return `Hourly :${minute.padStart(2, "0")}`;
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		/^\*\/\d+$/.test(hour)
	) {
		return `Every ${hour.slice(2)} hr`;
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return `Daily ${formatCronTime(hour, minute)}`;
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "1-5" &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return `Weekdays ${formatCronTime(hour, minute)}`;
	}

	if (
		dayOfMonth === "*" &&
		month === "*" &&
		isCronDayOfWeek(dayOfWeek) &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return `Weekly ${formatCronDayOfWeek(dayOfWeek)} ${formatCronTime(hour, minute)}`;
	}

	if (
		isCronDayOfMonth(dayOfMonth) &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return `Monthly day ${dayOfMonth} ${formatCronTime(hour, minute)}`;
	}

	return schedule;
}

function formatCronTime(hour: string, minute: string): string {
	return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function isCronDayOfWeek(value: string): boolean {
	return /^(0|1|2|3|4|5|6|7)$/.test(value);
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

function fallbackCronEntries(
	treeEntries: BrowserTreeEntry[] | undefined,
): BrowserCronEntry[] {
	const cronDirectory = treeEntries?.find(
		(entry) => entry.kind === "directory" && entry.path === "cron",
	);
	return (
		cronDirectory?.children
			?.filter(
				(entry) =>
					entry.kind === "file" &&
					(entry.path.endsWith(".yaml") || entry.path.endsWith(".yml")),
			)
			.map((entry) => ({
				name: entry.name,
				path: entry.path,
				schedule: "Schedule unavailable",
				enabled: true,
			})) ?? []
	);
}

export function CronPanel({
	agentId,
	treeEntries,
	onOpenFile,
}: CronPanelProps) {
	const cronRevision = useRightPanelRefreshStore(
		(state) => state.cronRevisionByAgent[agentId] ?? 0,
	);
	const [entries, setEntries] = useState<BrowserCronEntry[]>([]);
	const [pendingPaths, setPendingPaths] = useState<Record<string, boolean>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [mutationError, setMutationError] = useState<string | null>(null);
	const fallbackEntries = useMemo(
		() => fallbackCronEntries(treeEntries),
		[treeEntries],
	);

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

	if (loading) {
		return (
			<div className="px-4 py-4 text-sm text-dark-500">Loading cron jobs…</div>
		);
	}

	if (error && fallbackEntries.length === 0) {
		return <div className="px-4 py-4 text-sm text-red-300">{error}</div>;
	}

	const visibleEntries =
		entries.length > 0 ? entries : error ? fallbackEntries : entries;

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
					<div className="px-2 py-2 text-xs text-red-300">{error}</div>
				) : null}
				{mutationError ? (
					<div className="px-2 py-2 text-xs text-red-300">{mutationError}</div>
				) : null}
				{visibleEntries.map((entry) => (
					<div
						key={entry.path}
						className="border-t border-dark-900 first:border-t-0"
					>
						<div
							className={`grid ${CRON_TABLE_COLUMNS} items-center gap-3 rounded px-2 py-2.5 text-sm text-dark-400 transition-colors hover:bg-dark-900 hover:text-dark-200`}
						>
							<button
								type="button"
								onClick={() => onOpenFile({ agentId, path: entry.path })}
								className={`col-span-2 grid min-w-0 ${CRON_ROW_COLUMNS} items-center gap-3 text-left`}
							>
								<div className="flex min-w-0 items-center gap-2 text-dark-200">
									<Clock3 size={14} className="shrink-0 text-dark-500" />
									<span className="truncate">{entry.name}</span>
								</div>
								<div className="truncate text-xs text-dark-500">
									{humanizeCronSchedule(entry.schedule)}
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
										entry.enabled ? "bg-emerald-300/35" : "bg-white/10"
									} ${pendingPaths[entry.path] ? "opacity-60" : ""}`}
								>
									<div
										className={`absolute top-0.5 h-3 w-3 rounded-full transition-transform ${
											entry.enabled ? "bg-emerald-300" : "bg-white"
										} ${entry.enabled ? "translate-x-3.5" : "translate-x-0.5"}`}
									/>
								</div>
							</button>
						</div>
						{entry.error ? (
							<div className="px-2 pb-2 text-xs text-red-300">
								{entry.error}
							</div>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
