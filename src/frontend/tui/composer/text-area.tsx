import { ControlledMultilineInput } from "ink-multiline-input";
import { useEffect, useState } from "react";
import { useLatestRef } from "../use-latest-ref.ts";
import { useTextAreaInput } from "./input.ts";
import { applyTextAreaKeypress } from "./keypress.ts";

export interface TextAreaProps {
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	cursor?: number;
	focus?: boolean;
	captureInput?: boolean;
	rows?: number;
	maxRows?: number;
	placeholder?: string;
}

export function resolveTextAreaCursor(
	value: string,
	cursor: number,
	cursorOverride?: number,
): number {
	const nextCursor = cursorOverride ?? cursor;
	return Math.max(0, Math.min(value.length, nextCursor));
}

export function TextArea({
	value,
	onChange,
	onSubmit,
	cursor: cursorOverride,
	focus = true,
	captureInput = focus,
	rows,
	maxRows,
	placeholder,
}: TextAreaProps) {
	const [cursor, setCursor] = useState(cursorOverride ?? value.length);
	const [preferredColumn, setPreferredColumn] = useState<number | null>(null);
	const resolvedCursor = resolveTextAreaCursor(value, cursor, cursorOverride);
	const stateRef = useLatestRef({
		value,
		cursor: resolvedCursor,
		preferredColumn,
	});

	useEffect(() => {
		if (cursor > value.length) setCursor(value.length);
	}, [value.length, cursor]);

	useTextAreaInput((events) => {
		let state = stateRef.current;
		let changed = false;

		for (const { input, key, sequence } of events) {
			const result = applyTextAreaKeypress(state, input, key, sequence);
			if (!result.handled) continue;
			if (result.submit) {
				onSubmit(result.value);
				return;
			}
			if (result.value !== state.value || result.cursor !== state.cursor) {
				state = {
					value: result.value,
					cursor: result.cursor,
					preferredColumn: result.preferredColumn,
				};
				stateRef.current = state;
				changed = true;
			}
		}

		if (changed) {
			onChange(state.value);
			setCursor(state.cursor);
			setPreferredColumn(state.preferredColumn);
		}
	}, focus && captureInput);

	return (
		<ControlledMultilineInput
			value={value}
			cursorIndex={resolvedCursor}
			showCursor={true}
			focus={focus}
			rows={rows}
			maxRows={maxRows}
			placeholder={placeholder}
		/>
	);
}
