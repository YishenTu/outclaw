import type { LiveTranscriptEventLike } from "../components/transcript/live-transcript-stream.ts";

export interface ToolDetailView {
	label: string;
	value: string;
}

export interface UpdatePlanStep {
	step: string;
	status: string;
}

export function readToolDetails(value: unknown): ToolDetailView[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((entry): ToolDetailView | undefined => {
			if (!entry || typeof entry !== "object") {
				return undefined;
			}
			const record = entry as Record<string, unknown>;
			const label = typeof record.label === "string" ? record.label : undefined;
			const detailValue =
				typeof record.value === "string" ? record.value : undefined;
			return label && detailValue ? { label, value: detailValue } : undefined;
		})
		.filter((entry): entry is ToolDetailView => entry !== undefined);
}

export function sameToolDetails(
	left: ToolDetailView[],
	right: ToolDetailView[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(detail, index) =>
				detail.label === right[index]?.label &&
				detail.value === right[index]?.value,
		)
	);
}

export function asPayloadRecord(
	value: unknown,
): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function readUpdatePlanArguments(
	event: LiveTranscriptEventLike | undefined,
): { explanation?: string; steps: UpdatePlanStep[] } | undefined {
	if (!event) {
		return undefined;
	}
	const raw = readToolDetails(event.details).find(
		(detail) => detail.label === "arguments",
	)?.value;
	if (!raw) {
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
					const stepRecord = asPayloadRecord(entry);
					const step =
						typeof stepRecord?.step === "string" ? stepRecord.step : undefined;
					const status =
						typeof stepRecord?.status === "string"
							? stepRecord.status
							: undefined;
					return step && status ? { step, status } : undefined;
				})
				.filter((step): step is UpdatePlanStep => step !== undefined)
		: [];
	return explanation || steps.length > 0
		? { ...(explanation ? { explanation } : {}), steps }
		: undefined;
}

export function planProgressLabel(steps: UpdatePlanStep[]): string | undefined {
	if (steps.length === 0) {
		return undefined;
	}
	const completed = steps.filter((step) => step.status === "completed").length;
	return `${completed}/${steps.length} done`;
}
