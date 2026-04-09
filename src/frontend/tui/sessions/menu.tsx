import { Box, Text, useStdout } from "ink";
import { useCallback, useEffect, useState } from "react";
import { theme } from "../chrome/theme.ts";
import { useTerminalInput } from "../composer/input.ts";
import { TextArea } from "../composer/text-area.tsx";
import { formatSessionMenuItem } from "./format.ts";
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
	const [cursor, setCursor] = useState(0);
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 80;
	const labelWidth = columns - 4;

	useEffect(() => {
		if (cursor >= choices.length && choices.length > 0) {
			setCursor(choices.length - 1);
		}
	}, [choices.length, cursor]);

	useTerminalInput(({ input, key }) => {
		if (choices.length === 0) {
			if (key.escape) {
				onDismiss();
			}
			return;
		}
		if (key.escape) {
			onDismiss();
			return;
		}
		if (key.return) {
			const choice = choices[cursor];
			if (choice) {
				onSelect(choice);
			}
			return;
		}
		if (input === "d") {
			const choice = choices[cursor];
			if (choice) {
				onDelete(choice);
			}
			return;
		}
		if (input === "r") {
			const choice = choices[cursor];
			if (choice) {
				setRenameValue(choice.title);
				setRenaming(true);
			}
			return;
		}
		if (key.upArrow) {
			setCursor((previous) =>
				previous > 0 ? previous - 1 : choices.length - 1,
			);
		}
		if (key.downArrow) {
			setCursor((previous) =>
				previous < choices.length - 1 ? previous + 1 : 0,
			);
		}
	}, !renaming);

	const handleRenameSubmit = useCallback(
		(value: string) => {
			const choice = choices[cursor];
			const trimmed = value.trim();
			if (choice && trimmed) {
				onRename(choice, trimmed);
			}
			setRenaming(false);
		},
		[choices, cursor, onRename],
	);

	const handleRenameCancel = useCallback(() => {
		setRenaming(false);
	}, []);

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
								onChange={setRenameValue}
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
	useTerminalInput(({ key }) => {
		if (key.escape) {
			onCancel();
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
