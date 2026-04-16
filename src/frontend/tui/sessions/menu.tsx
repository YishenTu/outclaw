import { Box, Text, useStdout } from "ink";
import { useCallback, useEffect, useState } from "react";
import { theme } from "../chrome/theme.ts";
import { useTerminalInput } from "../composer/input.ts";
import { TextArea } from "../composer/text-area.tsx";
import { useLatestRef } from "../use-latest-ref.ts";
import { formatSessionMenuItem } from "./format.ts";
import {
	createSessionMenuState,
	normalizeSessionMenuState,
	reduceSessionMenuBatch,
} from "./menu-state.ts";
import type { SessionMenuChoice } from "./types.ts";

interface SessionMenuProps {
	choices: SessionMenuChoice[];
	onSelect: (choice: SessionMenuChoice) => void;
	onDelete: (choice: SessionMenuChoice) => void;
	onRename: (choice: SessionMenuChoice, title: string) => void;
	onDismiss: () => void;
}

export function SessionMenu({
	choices,
	onSelect,
	onDelete,
	onRename,
	onDismiss,
}: SessionMenuProps) {
	const [menuState, setMenuState] = useState(() => createSessionMenuState());
	const menuStateRef = useLatestRef(menuState);
	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 80;
	const labelWidth = columns - 4;
	const { cursor, renaming, renameValue } = menuState;

	useEffect(() => {
		const nextState = normalizeSessionMenuState(menuStateRef.current, choices);
		if (nextState !== menuStateRef.current) {
			menuStateRef.current = nextState;
			setMenuState(nextState);
		}
	}, [choices, menuStateRef]);

	useTerminalInput((events) => {
		const result = reduceSessionMenuBatch(
			menuStateRef.current,
			events,
			choices,
		);
		if (result.state !== menuStateRef.current) {
			menuStateRef.current = result.state;
			setMenuState(result.state);
		}

		if (result.effect.type === "dismiss") {
			onDismiss();
			return;
		}

		if (result.effect.type === "select") {
			onSelect(result.effect.choice);
			return;
		}

		if (result.effect.type === "delete") {
			onDelete(result.effect.choice);
		}
	}, !renaming);

	const handleRenameSubmit = useCallback(
		(value: string) => {
			const nextState = normalizeSessionMenuState(
				menuStateRef.current,
				choices,
			);
			const choice = choices[nextState.cursor];
			const trimmed = value.trim();
			if (choice && trimmed) {
				onRename(choice, trimmed);
			}
			const resolvedState = { ...nextState, renaming: false };
			menuStateRef.current = resolvedState;
			setMenuState(resolvedState);
		},
		[choices, menuStateRef, onRename],
	);

	const handleRenameCancel = useCallback(() => {
		const nextState = { ...menuStateRef.current, renaming: false };
		menuStateRef.current = nextState;
		setMenuState(nextState);
	}, [menuStateRef]);

	const handleRenameChange = useCallback(
		(value: string) => {
			const nextState = { ...menuStateRef.current, renameValue: value };
			menuStateRef.current = nextState;
			setMenuState(nextState);
		},
		[menuStateRef],
	);

	return (
		<Box flexDirection="column">
			<Text bold>Sessions</Text>
			{choices.map((choice, index) => {
				const pointer = index === cursor ? "▸ " : "  ";
				if (renaming && index === cursor) {
					return (
						<Box key={choice.sdkSessionId}>
							<Text color={theme.accent}>{pointer}</Text>
							<RenameInput
								value={renameValue}
								onChange={handleRenameChange}
								onSubmit={handleRenameSubmit}
								onCancel={handleRenameCancel}
							/>
						</Box>
					);
				}

				const label = formatSessionMenuItem(choice, labelWidth);
				return (
					<Text
						key={choice.sdkSessionId}
						color={index === cursor ? theme.accent : undefined}
					>
						{pointer}
						{label}
					</Text>
				);
			})}
			<Text dimColor>
				{renaming
					? "Enter confirm · Esc cancel"
					: "Enter select · d delete · r rename · Esc dismiss"}
			</Text>
		</Box>
	);
}

function RenameInput({
	value,
	onChange,
	onSubmit,
	onCancel,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}) {
	useTerminalInput((events) => {
		for (const { key } of events) {
			if (key.escape) {
				onCancel();
				return;
			}
		}
	}, true);

	return (
		<TextArea
			value={value}
			onChange={onChange}
			onSubmit={onSubmit}
			rows={1}
			maxRows={1}
		/>
	);
}
