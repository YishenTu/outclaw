import { ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
	BrowserCronEntry,
	BrowserTreeEntry,
} from "../../../../common/protocol.ts";
import { fetchAgentCron, updateAgentCronEnabled } from "../../lib/api.ts";

interface CronPanelProps {
	agentId: string;
	treeEntries?: BrowserTreeEntry[];
	onOpenFile: (params: { agentId: string; path: string }) => void;
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
		/^\d+$/.test(minute) &&
		/^\d+$/.test(hour)
	) {
		return `${Number(hour)}:${minute.padStart(2, "0")} daily`;
	}

	if (
		hour === "*" &&
		dayOfMonth === "*" &&
		month === "*" &&
		dayOfWeek === "*" &&
		/^\*\/\d+$/.test(minute)
	) {
		return `Every ${minute.slice(2)} minutes`;
	}

	return schedule;
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
	const [entries, setEntries] = useState<BrowserCronEntry[]>([]);
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>(
		{},
	);
	const [pendingPaths, setPendingPaths] = useState<Record<string, boolean>>({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [mutationError, setMutationError] = useState<string | null>(null);
	const fallbackEntries = useMemo(
		() => fallbackCronEntries(treeEntries),
		[treeEntries],
	);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setMutationError(null);
		void fetchAgentCron(agentId)
			.then((nextEntries) => {
				if (!cancelled) {
					setEntries(nextEntries);
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
	}, [agentId, fallbackEntries]);

	useEffect(() => {
		setExpandedPaths((current) => {
			const nextEntries =
				entries.length > 0 ? entries : error ? fallbackEntries : [];
			if (nextEntries.length === 0) {
				return current;
			}

			return Object.fromEntries(
				nextEntries.map((entry) => [entry.path, current[entry.path] ?? false]),
			);
		});
	}, [entries, error, fallbackEntries]);

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
		<div className="space-y-0.5 px-3 py-3">
			{error ? (
				<div className="px-2 py-2 text-xs text-red-300">{error}</div>
			) : null}
			{mutationError ? (
				<div className="px-2 py-2 text-xs text-red-300">{mutationError}</div>
			) : null}
			{visibleEntries.map((entry) => (
				<div key={entry.path} className="rounded">
					<div className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-dark-400 transition-colors hover:bg-dark-900 hover:text-dark-200">
						<button
							type="button"
							onClick={() =>
								setExpandedPaths((current) => ({
									...current,
									[entry.path]: !current[entry.path],
								}))
							}
							className="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							{expandedPaths[entry.path] ? (
								<ChevronDown size={14} className="shrink-0" />
							) : (
								<ChevronRight size={14} className="shrink-0" />
							)}
							<Clock3 size={14} className="shrink-0" />
							<div className="min-w-0 flex-1 truncate text-sm text-dark-200">
								{entry.name}
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
								void updateAgentCronEnabled(agentId, entry.path, !entry.enabled)
									.then((nextEntry) => {
										setEntries((current) =>
											current.map((currentEntry) =>
												currentEntry.path === nextEntry.path
													? { ...currentEntry, ...nextEntry, error: undefined }
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
							className="shrink-0"
							aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name}`}
						>
							<div
								aria-hidden="true"
								className={`relative h-4 w-7 rounded-full transition-colors ${
									entry.enabled ? "bg-dark-300/70" : "bg-dark-800"
								} ${pendingPaths[entry.path] ? "opacity-60" : ""}`}
							>
								<div
									className={`absolute top-0.5 h-3 w-3 rounded-full bg-dark-950 transition-transform ${
										entry.enabled ? "translate-x-3.5" : "translate-x-0.5"
									}`}
								/>
							</div>
						</button>
					</div>
					{expandedPaths[entry.path] && (
						<div className="space-y-1 pb-2 pl-10 pr-2">
							<div className="text-xs text-dark-500">
								<span className="text-dark-300">Schedule:</span>{" "}
								{humanizeCronSchedule(entry.schedule)}
							</div>
							<div className="text-xs text-dark-500">
								<span className="text-dark-300">Model:</span>{" "}
								{entry.model ?? "Default"}
							</div>
							{entry.error && (
								<div className="text-xs text-red-300">{entry.error}</div>
							)}
							<button
								type="button"
								onClick={() => onOpenFile({ agentId, path: entry.path })}
								className="text-xs text-dark-400 transition-colors hover:text-dark-200"
							>
								Open config
							</button>
						</div>
					)}
				</div>
			))}
		</div>
	);
}
