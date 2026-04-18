import { useState } from "react";
import { useContextUsageStore } from "../../stores/context-usage.ts";
import { useRuntimeStore } from "../../stores/runtime.ts";

const SIZE = 16;
const CENTER = SIZE / 2;
const RADIUS = 6;
const ARC_START = 240;
const ARC_END = 480;

interface ContextGaugeProps {
	sessionKey: string | null;
}

function formatTokenCount(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${Math.round(tokens / 1_000)}k`;
	}
	return String(tokens);
}

function polarToCartesian(
	centerX: number,
	centerY: number,
	radius: number,
	angleDeg: number,
) {
	const radians = ((angleDeg - 90) * Math.PI) / 180;
	return {
		x: centerX + radius * Math.cos(radians),
		y: centerY + radius * Math.sin(radians),
	};
}

function describeArc(
	centerX: number,
	centerY: number,
	radius: number,
	startAngle: number,
	endAngle: number,
) {
	const start = polarToCartesian(centerX, centerY, radius, endAngle);
	const end = polarToCartesian(centerX, centerY, radius, startAngle);
	const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
	return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export function ContextGauge({ sessionKey }: ContextGaugeProps) {
	const [showTooltip, setShowTooltip] = useState(false);
	const storedUsage = useContextUsageStore((state) =>
		sessionKey ? state.usage[sessionKey] : undefined,
	);
	const runtimeUsage = useRuntimeStore((state) => state.usage);
	const usage = storedUsage ?? runtimeUsage;

	if (!usage) {
		return null;
	}

	const percentage =
		usage.contextWindow > 0
			? Math.min(
					100,
					Math.max(0, (usage.contextTokens / usage.contextWindow) * 100),
				)
			: usage.percentage;
	const fillAngle = ARC_START + (percentage / 100) * (ARC_END - ARC_START);
	const warning = percentage >= 80;

	return (
		<div
			role="img"
			aria-label={`Context window usage: ${Math.round(percentage)}%`}
			className="relative flex items-center gap-1 px-1"
			onMouseEnter={() => setShowTooltip(true)}
			onMouseLeave={() => setShowTooltip(false)}
		>
			<svg
				aria-hidden="true"
				width={SIZE}
				height={SIZE}
				viewBox={`0 0 ${SIZE} ${SIZE}`}
			>
				<path
					d={describeArc(CENTER, CENTER, RADIUS, ARC_START, ARC_END)}
					fill="none"
					stroke={warning ? "rgb(var(--danger))" : "var(--dark-500)"}
					strokeLinecap="round"
					strokeWidth={2}
					opacity={0.35}
				/>
				<path
					d={describeArc(CENTER, CENTER, RADIUS, ARC_START, fillAngle)}
					fill="none"
					stroke={warning ? "rgb(var(--danger))" : "rgb(var(--brand))"}
					strokeLinecap="round"
					strokeWidth={2}
				/>
			</svg>
			<span className="text-xs text-dark-400">{Math.round(percentage)}%</span>
			{showTooltip && (
				<div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded border border-dark-800 bg-dark-900 px-2 py-1 text-xs text-dark-200 shadow-lg">
					{formatTokenCount(usage.contextTokens)} /{" "}
					{formatTokenCount(usage.contextWindow)}
				</div>
			)}
		</div>
	);
}
