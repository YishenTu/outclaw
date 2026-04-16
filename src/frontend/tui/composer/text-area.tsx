import { ControlledMultilineInput } from "ink-multiline-input";
import { useEffect, useRef, useState } from "react";
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

	const stateRef = useRef({ value, cursor: resolvedCursor, preferredColumn });
	stateRef.current = { value, cursor: resolvedCursor, preferredColumn };

	useEffect(() => {
		if (cursor > value.length) setCursor(value.length);
	}, [value.length, cursor]);

	const edit = (result: {
		value: string;
		cursor: number;
		preferredColumn: number | null;
	}) => {
		onChange(result.value);
		setCursor(result.cursor);
		setPreferredColumn(result.preferredColumn);
	};

	useTextAreaInput(({ input, key, sequence }) => {
		const current = stateRef.current;
		const result = applyTextAreaKeypress(current, input, key, sequence);
		if (!result.handled) return;
		if (result.submit) {
			onSubmit(result.value);
			return;
		}
		if (result.value !== current.value || result.cursor !== current.cursor) {
			stateRef.current = {
				value: result.value,
				cursor: result.cursor,
				preferredColumn: result.preferredColumn,
			};
			edit(result);
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
