import { Check, Copy } from "lucide-react";
import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";

const turnTimestampFormatter = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	hour12: false,
	minute: "2-digit",
});

interface AssistantTurnUtilityBarProps {
	content: string;
	timestamp?: number;
	turnStartedAt?: number;
}

export function AssistantTurnUtilityBar({
	content,
	timestamp,
	turnStartedAt,
}: AssistantTurnUtilityBarProps) {
	const canCopy = content.trim() !== "";
	const durationLabel = formatTurnDuration(turnStartedAt, timestamp);
	const timestampLabel = formatTurnTimestamp(timestamp);
	const { copied, copy } = useCopyToClipboard();

	return (
		<div className="font-mono-ui mt-2 flex items-center justify-between gap-3 px-3 text-[11px] uppercase tracking-[0.12em] text-dark-500">
			<div className="flex min-w-0 items-center gap-2">
				{durationLabel ? (
					<span className="tabular-nums">{durationLabel}</span>
				) : null}
				<AssistantTurnCopyButton
					copied={copied}
					disabled={!canCopy}
					onClick={() => copy(content)}
				/>
			</div>

			{timestamp !== undefined && timestampLabel ? (
				<time
					dateTime={new Date(timestamp).toISOString()}
					className="tabular-nums"
				>
					{timestampLabel}
				</time>
			) : null}
		</div>
	);
}

export function AssistantTurnCopyButton({
	copied,
	disabled,
	onClick,
}: {
	copied: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={copied ? "Copied final result" : "Copy final result"}
			className={`inline-flex items-center justify-center rounded p-1 transition-colors disabled:cursor-not-allowed disabled:text-dark-600 ${
				copied ? "text-success" : "text-dark-300 hover:text-dark-100"
			}`}
		>
			{copied ? (
				<Check size={11} strokeWidth={1.8} aria-hidden="true" />
			) : (
				<Copy size={11} strokeWidth={1.8} aria-hidden="true" />
			)}
		</button>
	);
}

function formatTurnDuration(
	turnStartedAt: number | undefined,
	timestamp: number | undefined,
): string | undefined {
	if (
		turnStartedAt === undefined ||
		timestamp === undefined ||
		timestamp < turnStartedAt
	) {
		return undefined;
	}

	const totalSeconds = Math.max(
		0,
		Math.round((timestamp - turnStartedAt) / 1000),
	);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	if (totalSeconds < 3_600) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	}

	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatTurnTimestamp(
	timestamp: number | undefined,
): string | undefined {
	if (timestamp === undefined) {
		return undefined;
	}

	return turnTimestampFormatter.format(timestamp);
}
