import { Check, Copy, CopyX } from "lucide-react";
import { useCopyToClipboard } from "../../clipboard/use-copy-to-clipboard.ts";

const turnTimestampFormatter = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	hour12: false,
	minute: "2-digit",
});

interface AssistantTurnUtilityBarProps {
	content: string;
	durationMs?: number;
	timestamp?: number;
}

export function AssistantTurnUtilityBar({
	content,
	durationMs,
	timestamp,
}: AssistantTurnUtilityBarProps) {
	const canCopy = content.trim() !== "";
	const durationLabel = formatTurnDuration(durationMs);
	const timestampLabel = formatTurnTimestamp(timestamp);
	const { copied, failed, copy } = useCopyToClipboard();

	return (
		<div className="font-mono-ui mt-2 flex items-center justify-between gap-3 px-3 text-[11px] uppercase tracking-[0.12em] text-dark-500">
			<div className="flex min-w-0 items-center gap-2">
				{durationLabel ? (
					<span className="tabular-nums">{durationLabel}</span>
				) : null}
				<AssistantTurnCopyButton
					copied={copied}
					disabled={!canCopy}
					failed={failed}
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
	failed = false,
	onClick,
}: {
	copied: boolean;
	disabled: boolean;
	failed?: boolean;
	onClick: () => void;
}) {
	const label = copied
		? "Copied final result"
		: failed
			? "Copy failed"
			: "Copy final result";
	const toneClass = copied
		? "text-success"
		: failed
			? "text-danger"
			: "text-dark-300 hover:text-dark-100";

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			className={`inline-flex items-center justify-center rounded p-1 transition-colors disabled:cursor-not-allowed disabled:text-dark-600 ${
				toneClass
			}`}
		>
			{copied ? (
				<Check size={11} strokeWidth={1.8} aria-hidden="true" />
			) : failed ? (
				<CopyX size={11} strokeWidth={1.8} aria-hidden="true" />
			) : (
				<Copy size={11} strokeWidth={1.8} aria-hidden="true" />
			)}
		</button>
	);
}

function formatTurnDuration(
	durationMs: number | undefined,
): string | undefined {
	if (durationMs === undefined || durationMs < 0) {
		return undefined;
	}

	const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
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
