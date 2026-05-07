import { Box, Text, useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionCursor } from "../../../common/protocol.ts";
import { theme } from "../chrome/theme.ts";
import { useTerminalInput } from "../composer/input.ts";
import { TextArea } from "../composer/text-area.tsx";
import { useLatestRef } from "../hooks/use-latest-ref.ts";
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
	nextCursor?: SessionCursor;
	onClearSearch?: () => void;
	onLoadMore?: (cursor: SessionCursor, query?: string) => void;
	onSearch?: (query: string) => void;
	searchQuery?: string;
}

export function SessionMenu({
	choices,
	onSelect,
	onDelete,
	onRename,
	onDismiss,
	nextCursor,
	onClearSearch,
	onLoadMore,
	onSearch,
	searchQuery,
}: SessionMenuProps) {
	const [menuState, setMenuState] = useState(() => createSessionMenuState());
	const [filterActive, setFilterActive] = useState(
		() => (searchQuery?.trim() ?? "") !== "",
	);
	const [filterValue, setFilterValue] = useState(searchQuery ?? "");
	const lastSyncedSearchQueryRef = useRef(searchQuery);
	const [loadingMore, setLoadingMore] = useState(false);
	const menuStateRef = useLatestRef(menuState);
	const { stdout } = useStdout();
	const columns = stdout?.columns ?? 80;
	const labelWidth = columns - 4;
	const { cursor, renaming, renameValue } = menuState;
	const displayedSearchQuery = searchQuery?.trim() || undefined;
	const loadingResetKey = `${choices.length}:${nextCursor?.lastActive ?? ""}:${
		nextCursor?.sdkSessionId ?? ""
	}`;

	useEffect(() => {
		const nextState = normalizeSessionMenuState(menuStateRef.current, choices);
		if (nextState !== menuStateRef.current) {
			menuStateRef.current = nextState;
			setMenuState(nextState);
		}
	}, [choices, menuStateRef]);

	useEffect(() => {
		void loadingResetKey;
		setLoadingMore(false);
	}, [loadingResetKey]);

	useEffect(() => {
		const previousSearchQuery = lastSyncedSearchQueryRef.current;
		if (searchQuery === previousSearchQuery) {
			return;
		}
		lastSyncedSearchQueryRef.current = searchQuery;
		if (searchQuery === undefined) {
			return;
		}
		if (!filterActive || filterValue === (previousSearchQuery ?? "")) {
			setFilterValue(searchQuery);
			setFilterActive(true);
		}
	}, [filterActive, filterValue, searchQuery]);

	useEffect(() => {
		if (!filterActive) {
			return;
		}
		const query = filterValue.trim();
		if (!query) {
			return;
		}
		const timer = setTimeout(() => {
			onSearch?.(query);
		}, 150);
		return () => clearTimeout(timer);
	}, [filterActive, filterValue, onSearch]);

	useTerminalInput((events) => {
		if (events.some((event) => event.input === "/")) {
			setFilterActive(true);
			return;
		}

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
		if (
			nextCursor &&
			onLoadMore &&
			!loadingMore &&
			events.some((event) => event.key.downArrow) &&
			result.state.cursor === choices.length - 1
		) {
			setLoadingMore(true);
			onLoadMore(nextCursor, displayedSearchQuery);
		}
	}, !renaming && !filterActive);

	useTerminalInput((events) => {
		const controlEvents = events.filter(
			(event) => event.key.upArrow || event.key.downArrow || event.key.return,
		);
		if (controlEvents.length === 0) {
			return;
		}

		const result = reduceSessionMenuBatch(
			menuStateRef.current,
			controlEvents,
			choices,
		);
		if (result.state !== menuStateRef.current) {
			menuStateRef.current = result.state;
			setMenuState(result.state);
		}
		if (result.effect.type === "select") {
			onSelect(result.effect.choice);
			return;
		}
		if (
			nextCursor &&
			onLoadMore &&
			!loadingMore &&
			controlEvents.some((event) => event.key.downArrow) &&
			result.state.cursor === choices.length - 1
		) {
			if (!displayedSearchQuery && filterValue.trim()) {
				return;
			}
			setLoadingMore(true);
			onLoadMore(nextCursor, displayedSearchQuery);
		}
	}, !renaming && filterActive);

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

	const handleFilterCancel = useCallback(() => {
		setFilterActive(false);
		setFilterValue("");
		onClearSearch?.();
	}, [onClearSearch]);

	return (
		<Box flexDirection="column">
			<Text bold>Sessions</Text>
			{filterActive && (
				<Box>
					<Text color={theme.accent}>Filter: </Text>
					<FilterInput
						value={filterValue}
						onChange={setFilterValue}
						onCancel={handleFilterCancel}
					/>
				</Box>
			)}
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
					: filterActive
						? "Type filter · ↑↓ move · Enter select · Esc clear"
						: "Enter select · / filter · d delete · r rename · Esc dismiss"}
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

function FilterInput({
	value,
	onChange,
	onCancel,
}: {
	value: string;
	onChange: (value: string) => void;
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
			onSubmit={() => undefined}
			rows={1}
			maxRows={1}
		/>
	);
}
