import figlet from "figlet";
import { Box, Text } from "ink";
import type React from "react";
import { theme } from "../chrome/theme.ts";

const GUTTER_COLOR = "gray";
const BANNER = figlet.textSync("OutCLAW", { font: "ANSI Shadow" }).trimEnd();

const COMMANDS: Array<[string, string]> = [
	["oc start", "start daemon"],
	["oc stop | restart | status", "daemon lifecycle"],
	["oc onboard", "create a new agent"],
	["oc tui", "open the TUI"],
	["oc dev", "dev: runtime hot reload"],
	["oc browser", "dev: browser UI hot reload"],
	["oc build", "dev: rebuild browser UI"],
];

interface Choice<T extends string> {
	label: string;
	note?: string;
	value: T;
}

export type OnboardingChoice<T extends string> = Choice<T>;

export function GutterLine({
	children,
	marker,
	markerColor = GUTTER_COLOR,
}: {
	children: React.ReactNode;
	marker: string;
	markerColor?: string;
}) {
	return (
		<Box>
			<Box width={2} flexShrink={0}>
				<Text color={markerColor}>{marker}</Text>
			</Box>
			<Box>{children}</Box>
		</Box>
	);
}

export function Spacer() {
	return (
		<GutterLine marker="│">
			<Text> </Text>
		</GutterLine>
	);
}

export function CommandsPanel() {
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={GUTTER_COLOR}
			paddingX={3}
			paddingY={1}
			marginBottom={1}
		>
			<Box alignItems="center" flexDirection="column">
				<Text bold color={theme.brand}>
					{BANNER}
				</Text>
			</Box>
			<Box
				alignItems="center"
				flexDirection="column"
				marginTop={1}
				marginBottom={1}
			>
				<Text dimColor>v0.0.1 · https://github.com/YishenTu/outclaw</Text>
			</Box>
			{COMMANDS.map(([command, description]) => (
				<Box key={command}>
					<Box width={34} flexShrink={0}>
						<Text>{command}</Text>
					</Box>
					<Text dimColor>{description}</Text>
				</Box>
			))}
		</Box>
	);
}

export function Answered({
	answer,
	question,
}: {
	answer: string;
	question: string;
}) {
	return (
		<>
			<GutterLine marker="◇" markerColor="green">
				<Text color={theme.accent}>{question}</Text>
			</GutterLine>
			<GutterLine marker="│">
				<Text>{answer}</Text>
			</GutterLine>
		</>
	);
}

export function ActiveText({
	error,
	hint,
	placeholder,
	question,
	value,
}: {
	error?: string;
	hint?: string;
	placeholder?: string;
	question: string;
	value: string;
}) {
	const showPlaceholder = value.length === 0 && placeholder;

	return (
		<>
			<GutterLine marker="◆" markerColor={theme.brand}>
				<Text bold color={theme.brand}>
					{question}
				</Text>
			</GutterLine>
			<GutterLine marker="│">
				<Box>
					{showPlaceholder ? (
						<Text dimColor italic>
							{placeholder}
						</Text>
					) : (
						<Text>{value}</Text>
					)}
					<Text color={theme.accent}>█</Text>
				</Box>
			</GutterLine>
			{error ? (
				<GutterLine marker="│">
					<Text color={theme.error}>▲ {error}</Text>
				</GutterLine>
			) : hint ? (
				<GutterLine marker="│">
					<Text dimColor>{hint}</Text>
				</GutterLine>
			) : null}
		</>
	);
}

export function ActiveSelect<T extends string>({
	choices,
	cursor,
	question,
}: {
	choices: Choice<T>[];
	cursor: number;
	question: string;
}) {
	return (
		<>
			<GutterLine marker="◆" markerColor={theme.brand}>
				<Text bold color={theme.brand}>
					{question}
				</Text>
			</GutterLine>
			{choices.map((choice, index) => {
				const active = index === cursor;
				return (
					<GutterLine key={choice.value} marker="│">
						<Box>
							<Text color={active ? "green" : undefined} dimColor={!active}>
								{active ? "● " : "○ "}
							</Text>
							<Text bold={active}>{choice.label}</Text>
							{choice.note ? (
								<>
									<Text> </Text>
									<Text color={theme.accent}>({choice.note})</Text>
								</>
							) : null}
						</Box>
					</GutterLine>
				);
			})}
			<GutterLine marker="│">
				<Text dimColor>↑/↓ move · Enter select · Esc back</Text>
			</GutterLine>
		</>
	);
}
