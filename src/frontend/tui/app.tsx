import { Box, Text, useApp } from "ink";
import { useCallback, useEffect, useState } from "react";
import {
	canonicalizePromptSlashCommand,
	isRuntimeCommand,
} from "../../common/commands.ts";
import { AgentMenu } from "./agents/menu.tsx";
import { HeaderBar } from "./chrome/header-bar.tsx";
import { StatusBar } from "./chrome/status-bar.tsx";
import { theme } from "./chrome/theme.ts";
import { CommandMenu } from "./command-menu/menu.tsx";
import { matchCommands } from "./command-menu/state.ts";
import { useTerminalInput, useTextAreaInput } from "./composer/input.ts";
import {
	clampCommandMenuIndex,
	createComposerState,
	reduceComposerBatch,
} from "./composer/state.ts";
import { TextArea } from "./composer/text-area.tsx";
import { sessionMenuChoices } from "./sessions/format.ts";
import { SessionMenu } from "./sessions/menu.tsx";
import { shouldEnableGlobalStopShortcut } from "./sessions/state.ts";
import type { SessionMenuChoice } from "./sessions/types.ts";
import { MessageList } from "./transcript/message-list.tsx";
import { useLatestRef } from "./use-latest-ref.ts";
import { useRuntimeSession } from "./use-runtime-session.ts";
import { useTerminalSize } from "./use-terminal-size.ts";

interface TuiAppProps {
	agentName?: string;
	url: string;
}

export function TuiApp({ url, agentName }: TuiAppProps) {
	const { exit } = useApp();
	const { columns, rows: termRows } = useTerminalSize();
	const [composerState, setComposerState] = useState(() =>
		createComposerState(),
	);
	const {
		agentMenuData,
		dismissAgentMenu,
		dismissSessionMenu,
		menuData,
		requestSkills,
		runCommand,
		runPrompt,
		runtimeInfo,
		skills,
		status,
		tuiState,
	} = useRuntimeSession(url, agentName);
	const composerStateRef = useLatestRef(composerState);
	const input = composerState.draft.value;
	const draftCursor = composerState.draft.cursor;
	const ignoreTextAreaChange = useCallback((_value: string) => {}, []);
	const ignoreTextAreaSubmit = useCallback((_value: string) => {}, []);
	const syncComposerState = useCallback(
		(nextState: typeof composerState) => {
			composerStateRef.current = nextState;
			setComposerState(nextState);
		},
		[composerStateRef],
	);
	const resetComposer = useCallback(() => {
		syncComposerState(createComposerState());
	}, [syncComposerState]);

	const handleSubmit = useCallback(
		(value: string) => {
			const trimmed = value.trim();
			if (!trimmed) {
				return;
			}

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

			const promptSlashCommand = canonicalizePromptSlashCommand(value);
			if (promptSlashCommand) {
				if (runPrompt(promptSlashCommand)) {
					resetComposer();
				}
				return;
			}

			if (runPrompt(value)) {
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

	const handleAgentSelect = useCallback(
		(agent: { name: string }) => {
			if (runCommand(`/agent ${agent.name}`)) {
				dismissAgentMenu();
			}
		},
		[dismissAgentMenu, runCommand],
	);

	const inputActive =
		!tuiState.running && menuData === null && agentMenuData === null;

	const matchedCommands = matchCommands(composerState.draft.value, skills);
	const cmdMenuIndex = clampCommandMenuIndex(
		composerState.cmdMenuIndex,
		matchedCommands.length,
	);
	const cmdMenuVisible =
		matchedCommands.length > 0 &&
		inputActive &&
		!composerState.cmdMenuDismissed;
	const shouldRequestSkills =
		status === "connected" &&
		inputActive &&
		skills.length === 0 &&
		composerState.draft.value.trimStart().startsWith("/");

	useEffect(() => {
		if (!shouldRequestSkills) {
			return;
		}

		requestSkills();
	}, [requestSkills, shouldRequestSkills]);

	useTextAreaInput((events) => {
		const result = reduceComposerBatch(composerStateRef.current, events, {
			inputActive,
			skills,
		});

		if (result.state !== composerStateRef.current) {
			syncComposerState(result.state);
		}

		if (result.effect.type === "submit") {
			handleSubmit(result.effect.value);
		}
	}, inputActive);

	useTerminalInput(
		(events) => {
			for (const { key } of events) {
				if (key.escape) {
					runCommand("/stop");
					return;
				}
			}
		},
		shouldEnableGlobalStopShortcut(
			tuiState.running,
			menuData !== null || agentMenuData !== null,
		),
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
			<Box marginTop={1} marginBottom={1} flexGrow={1} flexDirection="column">
				<MessageList
					messages={tuiState.messages}
					streaming={tuiState.streaming}
					streamingThinking={tuiState.streamingThinking}
					running={tuiState.running}
					compacting={tuiState.compacting}
					columns={columns}
				/>
			</Box>
			{agentMenuData ? (
				<Box paddingX={1}>
					<AgentMenu
						activeAgentId={agentMenuData.activeAgentId}
						agents={agentMenuData.agents}
						onDismiss={dismissAgentMenu}
						onSelect={handleAgentSelect}
					/>
				</Box>
			) : choices ? (
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
					{cmdMenuVisible && (
						<CommandMenu items={matchedCommands} selectedIndex={cmdMenuIndex} />
					)}
				</Box>
			)}
			{!cmdMenuVisible && (
				<Box paddingX={1}>
					<StatusBar status={status} info={runtimeInfo} />
				</Box>
			)}
		</Box>
	);
}
