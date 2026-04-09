import { Box, Text, useApp } from "ink";
import { useCallback, useState } from "react";
import { isRuntimeCommand } from "../../common/commands.ts";
import { HeaderBar } from "./chrome/header-bar.tsx";
import { StatusBar } from "./chrome/status-bar.tsx";
import { theme } from "./chrome/theme.ts";
import { useTerminalInput, useTextAreaInput } from "./composer/input.ts";
import {
	applyCollapsedPasteKeypress,
	createPasteAwareDraft,
} from "./composer/paste-draft.ts";
import { TextArea } from "./composer/text-area.tsx";
import { sessionMenuChoices } from "./sessions/format.ts";
import { SessionMenu } from "./sessions/menu.tsx";
import { shouldEnableGlobalStopShortcut } from "./sessions/state.ts";
import type { SessionMenuChoice } from "./sessions/types.ts";
import { MessageList } from "./transcript/message-list.tsx";
import { useRuntimeSession } from "./use-runtime-session.ts";
import { useTerminalSize } from "./use-terminal-size.ts";

interface TuiAppProps {
	url: string;
}

export function TuiApp({ url }: TuiAppProps) {
	const { exit } = useApp();
	const { columns, rows: termRows } = useTerminalSize();
	const [composerDraft, setComposerDraft] = useState(() =>
		createPasteAwareDraft(),
	);
	const {
		dismissSessionMenu,
		menuData,
		runCommand,
		runPrompt,
		runtimeInfo,
		status,
		tuiState,
	} = useRuntimeSession(url);
	const input = composerDraft.value;
	const draftCursor = composerDraft.cursor;
	const ignoreTextAreaChange = useCallback((_value: string) => {}, []);
	const ignoreTextAreaSubmit = useCallback((_value: string) => {}, []);
	const resetComposer = useCallback(() => {
		setComposerDraft(createPasteAwareDraft());
	}, []);

	const handleSubmit = useCallback(
		(value: string) => {
			const text = value;
			if (!text.trim()) {
				return;
			}

			const trimmed = text.trim();
			if (trimmed === "/exit") {
				exit();
				return;
			}

			if (isRuntimeCommand(trimmed)) {
				if (runCommand(trimmed)) {
					resetComposer();
				}
				return;
			}

			if (runPrompt(text)) {
				resetComposer();
			}
		},
		[exit, resetComposer, runCommand, runPrompt],
	);

	const handleMenuSelect = useCallback(
		(choice: SessionMenuChoice) => {
			if (runCommand(`/session ${choice.sdkSessionId}`)) {
				dismissSessionMenu();
			}
		},
		[dismissSessionMenu, runCommand],
	);

	const handleMenuDelete = useCallback(
		(choice: SessionMenuChoice) => {
			runCommand(`/session delete ${choice.sdkSessionId}`);
		},
		[runCommand],
	);

	const handleMenuRename = useCallback(
		(choice: SessionMenuChoice, title: string) => {
			runCommand(`/session rename ${choice.sdkSessionId} ${title}`);
		},
		[runCommand],
	);

	const inputActive = !tuiState.running && menuData === null;

	useTextAreaInput(({ input: inputKey, key, sequence }) => {
		const action = applyCollapsedPasteKeypress(
			composerDraft,
			inputKey,
			key,
			sequence,
		);
		if (action.type === "ignore") {
			return;
		}
		if (action.type === "clear") {
			resetComposer();
			return;
		}
		if (action.type === "submit") {
			handleSubmit(action.value ?? composerDraft.value);
			return;
		}
		if (action.type === "update" && action.draft) {
			setComposerDraft(action.draft);
		}
	}, inputActive);

	useTerminalInput(
		({ key }) => {
			if (key.escape) {
				runCommand("/stop");
			}
		},
		shouldEnableGlobalStopShortcut(tuiState.running, menuData !== null),
	);

	const choices = menuData
		? sessionMenuChoices(menuData.sessions, menuData.activeSessionId)
		: null;
	const divider = "─".repeat(columns);

	return (
		<Box flexDirection="column" paddingY={1}>
			<Box paddingX={1}>
				<HeaderBar />
			</Box>
			<Text color={theme.brand}>{"═".repeat(columns)}</Text>
			<Box marginTop={1} marginBottom={1} flexGrow={1} flexDirection="column">
				<MessageList
					messages={tuiState.messages}
					streaming={tuiState.streaming}
					running={tuiState.running}
					columns={columns}
				/>
			</Box>
			{choices ? (
				<Box paddingX={1}>
					<SessionMenu
						choices={choices}
						onSelect={handleMenuSelect}
						onDelete={handleMenuDelete}
						onRename={handleMenuRename}
						onDismiss={dismissSessionMenu}
					/>
				</Box>
			) : (
				<Box flexDirection="column">
					<Text dimColor>{divider}</Text>
					<Box paddingX={1} alignItems="flex-start">
						<Text bold color={theme.accent}>
							{"❯ "}
						</Text>
						<Box flexGrow={1} flexDirection="column">
							<TextArea
								key="draft-editor"
								value={input}
								onChange={ignoreTextAreaChange}
								onSubmit={ignoreTextAreaSubmit}
								cursor={draftCursor}
								focus={inputActive}
								captureInput={false}
								rows={1}
								maxRows={Math.max(5, Math.floor(termRows / 3))}
							/>
						</Box>
					</Box>
					<Text dimColor>{divider}</Text>
				</Box>
			)}
			<Box paddingX={1}>
				<StatusBar status={status} info={runtimeInfo} />
			</Box>
		</Box>
	);
}
