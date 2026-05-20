import { CircleStop, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	detectMentionToken,
	matchMentionEntries,
	replaceMentionToken,
} from "../../../../../common/mention.ts";
import type { WorkspaceFileEntry } from "../../../../../common/protocol.ts";
import { formatMaybeProviderSessionRef } from "../../../../../common/provider-session-ref.ts";
import {
	type ComposerImageAttachment,
	createComposerImageAttachment,
	filterSupportedImageFiles,
} from "../../../attachments/composer-images.ts";
import {
	type ComposerDraft,
	clearSubmittedDraftIfUnchanged,
} from "../../../chat/composer-draft.ts";
import { useWs } from "../../../contexts/websocket-context.tsx";
import { PENDING_SESSION_ID } from "../../../sessions/session.ts";
import { useAgentFilesStore } from "../../../stores/agent-files.ts";
import { useAgentsStore } from "../../../stores/agents.ts";
import { useComposerRecoveryStore } from "../../../stores/composer-recovery.ts";
import { useRuntimePopupStore } from "../../../stores/runtime-popup.ts";
import type { CommandEntry } from "../../../stores/slash-commands.ts";
import { useSlashCommandsStore } from "../../../stores/slash-commands.ts";
import { getImageThumbnailClassName } from "../../transcript/image-thumbnail-styles.ts";
import { ContextGauge } from "../context-gauge.tsx";
import { useGlobalStopShortcut } from "../global-stop-shortcut.ts";
import { HeartbeatIndicator } from "../heartbeat-indicator.tsx";
import { MentionMenu } from "../mention-menu.tsx";
import { type ChatModelSelection, ModelSelector } from "../model-selector.tsx";
import { RuntimeCommandPopup } from "../runtime-command-popup.tsx";
import { useRuntimePopupShortcuts } from "../runtime-popup-shortcuts.ts";
import { SlashCommandMenu } from "../slash-command-menu.tsx";
import {
	canSubmitMessageInput,
	filterSlashCommands,
	isSlashAutocompleteInput,
	resolveRuntimePopupItemCount,
	shouldShowSlashCommandMenu,
} from "./message-input-behavior.ts";
import { handleMessageInputKeydown } from "./message-input-keydown.ts";

const MAX_MENTION_RESULTS = 50;
const EMPTY_FILES: WorkspaceFileEntry[] = [];

interface MessageInputProps {
	onSend: (submission: {
		text: string;
		images: ComposerImageAttachment[];
	}) => Promise<boolean> | boolean;
	disabled?: boolean;
	interruptible?: boolean;
	sessionKey?: string | null;
	agentId?: string | null;
	providerId?: string | null;
	model: string | null;
	effort: string | null;
	serviceTier?: string | null;
	onModelChange: (selection: ChatModelSelection) => boolean;
	onEffortChange: (selection: ChatModelSelection) => boolean;
	active?: boolean;
	headerSlot?: React.ReactNode;
	compact?: boolean;
	/**
	 * Optional override for the model/effort controls. The coding composer
	 * uses this to mount a Codex-aware selector that reads its catalog from
	 * the coding store instead of the chat-side runtime status event.
	 */
	modelSelectorSlot?: React.ReactNode;
	attachmentsEnabled?: boolean;
	onInterrupt?: () => boolean;
	commandEntries?: CommandEntry[];
	commandMenuEmptyMessage?: string;
	commandTriggerChars?: readonly string[];
	fileMentionEntries?: WorkspaceFileEntry[];
	onFileMentionEntriesRequested?: () => Promise<void> | void;
}

export function MessageInput({
	onSend,
	disabled = false,
	interruptible = false,
	sessionKey = null,
	agentId = null,
	providerId = null,
	model,
	effort,
	serviceTier = null,
	onModelChange,
	onEffortChange,
	active = true,
	headerSlot,
	compact = false,
	modelSelectorSlot,
	attachmentsEnabled = true,
	onInterrupt,
	commandEntries,
	commandMenuEmptyMessage,
	commandTriggerChars = ["/"],
	fileMentionEntries,
	onFileMentionEntriesRequested,
}: MessageInputProps) {
	const { sendCommand } = useWs();
	const [value, setValue] = useState("");
	const [cursor, setCursor] = useState(0);
	const [images, setImages] = useState<ComposerImageAttachment[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
	const [mentionDismissed, setMentionDismissed] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const isComposingRef = useRef(false);
	const draftRef = useRef<ComposerDraft>({
		text: "",
		images: [],
	});
	const storeCommands = useSlashCommandsStore((state) => state.commands);
	const commands = commandEntries ?? storeCommands;
	const runtimePopup = useRuntimePopupStore((state) => state.popup);
	const closeRuntimePopup = useRuntimePopupStore((state) => state.closePopup);
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const agentFilesEntry = useAgentFilesStore((state) =>
		activeAgentId ? state.entriesByAgent[activeAgentId] : undefined,
	);
	const agentFiles = agentFilesEntry?.files ?? EMPTY_FILES;
	const mentionFiles = fileMentionEntries ?? agentFiles;
	const requestAgentFiles = useAgentFilesStore((state) => state.requestFiles);
	const saveRecoveryDraft = useComposerRecoveryStore(
		(state) => state.saveDraft,
	);
	const consumeRestorableDraft = useComposerRecoveryStore(
		(state) => state.consumeRestorableDraft,
	);
	const hasRestorableDraft = useComposerRecoveryStore((state) =>
		sessionKey
			? (state.draftsBySessionKey[sessionKey]?.restorable ?? false)
			: false,
	);
	const mentionToken = detectMentionToken(value, cursor);
	const mentionMatches: WorkspaceFileEntry[] = mentionToken
		? matchMentionEntries(mentionFiles, mentionToken.query, {
				limit: MAX_MENTION_RESULTS,
			})
		: [];
	const showMentionMenu =
		mentionToken !== null && mentionMatches.length > 0 && !mentionDismissed;
	const filteredCommands = filterSlashCommands(
		value,
		commands,
		commandTriggerChars,
	);
	const isCommandTriggerActive = isSlashAutocompleteInput(
		value,
		commandTriggerChars,
	);
	const showSlashMenu = shouldShowSlashCommandMenu({
		filteredCommandCount: filteredCommands.length,
		hasEmptyMessage: commandMenuEmptyMessage !== undefined,
		isTriggerActive: isCommandTriggerActive,
		showMentionMenu,
	});
	const canSend = canSubmitMessageInput({
		disabled,
		imageCount: images.length,
		submitting,
		value,
	});
	const isInputDisabled = disabled || submitting;
	const canInterrupt = interruptible && !isInputDisabled;
	const actionButtonEnabled = interruptible ? canInterrupt : canSend;
	const actionButtonLabel = interruptible ? "Stop response" : "Send message";
	const sessionActive =
		sessionKey !== null && !sessionKey.endsWith(`:${PENDING_SESSION_ID}`);
	const runtimePopupItemCount = resolveRuntimePopupItemCount(runtimePopup);

	function focusTextarea() {
		if (!active) {
			return;
		}

		window.requestAnimationFrame(() => {
			textareaRef.current?.focus();
		});
	}

	const replaceDraft = useCallback((nextDraft: ComposerDraft) => {
		draftRef.current = nextDraft;
		setValue(nextDraft.text);
		setImages(nextDraft.images);
	}, []);

	const interrupt = onInterrupt ?? (() => sendCommand("/stop"));

	useGlobalStopShortcut(active && interruptible, interrupt);

	useRuntimePopupShortcuts(runtimePopup, {
		enabled: active,
		selectedIndex,
		setSelectedIndex,
		selectIndex: (index) => {
			selectRuntimePopupItem(index);
		},
		closePopup: closeRuntimePopup,
		onDismiss: focusTextarea,
	});

	useEffect(() => {
		if (!active || !runtimePopup) {
			return;
		}

		textareaRef.current?.blur();
	}, [active, runtimePopup]);

	useEffect(() => {
		const itemCount = runtimePopup
			? runtimePopupItemCount
			: filteredCommands.length;
		if (selectedIndex < itemCount) {
			return;
		}

		setSelectedIndex(0);
	}, [
		filteredCommands.length,
		runtimePopup,
		runtimePopupItemCount,
		selectedIndex,
	]);

	useEffect(() => {
		if (mentionSelectedIndex < mentionMatches.length) {
			return;
		}
		setMentionSelectedIndex(0);
	}, [mentionMatches.length, mentionSelectedIndex]);

	useEffect(() => {
		if (!value.includes("@")) {
			return;
		}
		if (onFileMentionEntriesRequested) {
			void onFileMentionEntriesRequested();
			return;
		}
		if (!activeAgentId) {
			return;
		}
		void requestAgentFiles(activeAgentId);
	}, [activeAgentId, onFileMentionEntriesRequested, requestAgentFiles, value]);

	useEffect(() => {
		if (attachmentsEnabled) {
			return;
		}
		if (draftRef.current.images.length === 0) {
			return;
		}
		draftRef.current = {
			...draftRef.current,
			images: [],
		};
		setImages([]);
	}, [attachmentsEnabled]);

	useEffect(() => {
		if (!sessionKey || !hasRestorableDraft) {
			return;
		}

		const recoveredDraft = consumeRestorableDraft(sessionKey);
		if (!recoveredDraft) {
			return;
		}

		const currentDraft = draftRef.current;
		if (currentDraft.text !== "" || currentDraft.images.length > 0) {
			return;
		}

		replaceDraft(recoveredDraft);
		setCursor(recoveredDraft.text.length);
	}, [consumeRestorableDraft, hasRestorableDraft, sessionKey, replaceDraft]);

	function syncCursorFromTextarea() {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		setCursor(textarea.selectionStart ?? value.length);
	}

	function replaceDraftText(text: string) {
		replaceDraft({
			...draftRef.current,
			text,
		});
	}

	function updateDraftImages(
		updater: (images: ComposerImageAttachment[]) => ComposerImageAttachment[],
	) {
		replaceDraft({
			...draftRef.current,
			images: updater(draftRef.current.images),
		});
	}

	function applySlashCommand(command: CommandEntry) {
		closeRuntimePopup();
		const replacement = `${command.insertPrefix ?? "/"}${command.name} `;
		replaceDraftText(replacement);
		setCursor(replacement.length);
		setSelectedIndex(0);
		setMentionDismissed(false);
		focusTextarea();
	}

	function applyMentionEntry(index: number) {
		if (!mentionToken) {
			return;
		}
		const selected = mentionMatches[index] ?? mentionMatches[0];
		if (!selected) {
			return;
		}
		const replaced = replaceMentionToken(value, mentionToken, selected.path);
		replaceDraftText(replaced.value);
		setCursor(replaced.cursor);
		setMentionSelectedIndex(0);
		setMentionDismissed(false);
		window.requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			textarea?.focus();
			textarea?.setSelectionRange(replaced.cursor, replaced.cursor);
		});
	}

	async function appendFiles(files: File[]) {
		if (!attachmentsEnabled) {
			return;
		}
		const supportedFiles = filterSupportedImageFiles(files);
		if (supportedFiles.length === 0) {
			return;
		}

		const nextImages = await Promise.all(
			supportedFiles.map((file) => createComposerImageAttachment(file)),
		);
		updateDraftImages((current) => [...current, ...nextImages]);
	}

	function selectRuntimePopupItem(index: number) {
		if (!runtimePopup) {
			return;
		}

		if (runtimePopup.kind === "agent") {
			const agent = runtimePopup.agents[index];
			if (agent && sendCommand(`/agent ${agent.name}`)) {
				closeRuntimePopup();
				focusTextarea();
			}
			return;
		}

		if (runtimePopup.kind === "session") {
			const session = runtimePopup.sessions[index];
			const sessionRef = session
				? formatMaybeProviderSessionRef(session)
				: undefined;
			if (sessionRef && sendCommand(`/session ${sessionRef}`)) {
				closeRuntimePopup();
				focusTextarea();
			}
			return;
		}

		closeRuntimePopup();
		focusTextarea();
	}

	async function submitValue() {
		if (!canSend) {
			return;
		}

		setSubmitting(true);
		try {
			const submittedDraft = {
				text: value,
				images,
			};
			const sent = await onSend({
				text: submittedDraft.text,
				images: submittedDraft.images,
			});
			if (sent) {
				if (sessionKey && !sessionActive) {
					saveRecoveryDraft(sessionKey, submittedDraft);
				}
				closeRuntimePopup();
				const nextDraft = clearSubmittedDraftIfUnchanged(
					draftRef.current,
					submittedDraft,
				);
				replaceDraft(nextDraft);
				setSelectedIndex(0);
			}
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="px-2 pt-2 pb-1 md:p-4">
			<div className="mx-auto max-w-4xl">
				<section
					aria-label="Message input"
					className="relative rounded-lg border border-dark-700 bg-dark-900 p-2 transition-colors focus-within:border-brand/60 focus-within:shadow-[0_0_0_1px_rgb(var(--brand)/0.3)]"
				>
					{runtimePopup && runtimePopup.kind !== "status" ? (
						<RuntimeCommandPopup
							popup={runtimePopup}
							selectedIndex={selectedIndex}
							onSelect={selectRuntimePopupItem}
						/>
					) : showMentionMenu ? (
						<MentionMenu
							entries={mentionMatches}
							selectedIndex={mentionSelectedIndex}
							onSelect={(entry) => {
								const index = mentionMatches.findIndex(
									(item) =>
										item.path === entry.path && item.kind === entry.kind,
								);
								applyMentionEntry(index >= 0 ? index : 0);
							}}
						/>
					) : showSlashMenu ? (
						<SlashCommandMenu
							commands={filteredCommands}
							selectedIndex={selectedIndex}
							onSelect={applySlashCommand}
							emptyMessage={commandMenuEmptyMessage}
						/>
					) : null}
					{headerSlot ? (
						<div className="-mx-2 -mt-2 mb-2 border-b border-dark-700 px-3 py-1.5">
							{headerSlot}
						</div>
					) : null}
					{images.length > 0 && (
						<div className="mb-2 flex flex-wrap gap-2 px-2">
							{images.map((image, index) => (
								<div key={image.id} className="relative">
									<img
										src={`data:${image.image.mediaType};base64,${image.image.base64}`}
										alt={`Pending upload ${index + 1}`}
										className={getImageThumbnailClassName("composer")}
									/>
									<button
										type="button"
										onClick={() =>
											updateDraftImages((current) =>
												current.filter((entry) => entry.id !== image.id),
											)
										}
										disabled={submitting}
										className="font-mono-ui absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-dark-700 bg-dark-950 text-[10px] text-dark-300"
										aria-label={`Remove pending image ${index + 1}`}
									>
										×
									</button>
								</div>
							))}
						</div>
					)}
					<div
						className={`relative ${compact ? "h-[36px] md:h-[64px]" : "h-[115px]"}`}
					>
						<textarea
							ref={textareaRef}
							value={value}
							disabled={isInputDisabled}
							onChange={(event) => {
								replaceDraftText(event.target.value);
								setCursor(
									event.target.selectionStart ?? event.target.value.length,
								);
								setMentionDismissed(false);
							}}
							onSelect={syncCursorFromTextarea}
							onClick={syncCursorFromTextarea}
							onKeyUp={syncCursorFromTextarea}
							onPaste={(event) => {
								if (!attachmentsEnabled) {
									return;
								}
								const files = filterSupportedImageFiles(
									Array.from(event.clipboardData.files),
								);
								if (files.length === 0) {
									return;
								}

								event.preventDefault();
								void appendFiles(files);
							}}
							onDragOver={(event) => {
								if (!attachmentsEnabled) {
									return;
								}
								const files = filterSupportedImageFiles(
									Array.from(event.dataTransfer.files),
								);
								if (files.length === 0) {
									return;
								}

								event.preventDefault();
							}}
							onDrop={(event) => {
								if (!attachmentsEnabled) {
									return;
								}
								event.preventDefault();
								void appendFiles(Array.from(event.dataTransfer.files));
							}}
							onCompositionStart={() => {
								isComposingRef.current = true;
							}}
							onCompositionEnd={() => {
								isComposingRef.current = false;
							}}
							onKeyDown={(event) => {
								handleMessageInputKeydown(
									event,
									{
										showSlashMenu,
										filteredCommandCount: filteredCommands.length,
										selectedIndex,
										interruptible,
										isComposing: isComposingRef.current,
										showMentionMenu,
										mentionItemCount: mentionMatches.length,
										mentionSelectedIndex,
									},
									{
										setSelectedIndex,
										applySelectedSlashCommand: (index) => {
											const selectedCommand =
												filteredCommands[index] ?? filteredCommands[0];
											if (selectedCommand) {
												applySlashCommand(selectedCommand);
											}
										},
										sendStopCommand: interrupt,
										submitValue: () => {
											void submitValue();
										},
										setMentionSelectedIndex,
										applySelectedMention: (index) => {
											applyMentionEntry(index);
										},
										dismissMentionMenu: () => {
											setMentionDismissed(true);
										},
									},
								);
							}}
							placeholder={
								attachmentsEnabled
									? "Type a message or paste/drop an image..."
									: "Type a message..."
							}
							className="scrollbar-none h-full w-full resize-none bg-transparent px-2 pt-1 text-sm text-dark-100 placeholder:text-dark-500"
						/>
					</div>
					<div className="flex items-center justify-between gap-3 px-1 pt-1">
						<div className="flex min-w-0 items-center gap-1 overflow-visible">
							{modelSelectorSlot ?? (
								<ModelSelector
									agentId={agentId}
									providerId={providerId}
									model={model}
									effort={effort}
									serviceTier={serviceTier}
									sessionActive={sessionActive}
									disabled={isInputDisabled}
									showEffortLabelPrefix={!compact}
									onModelChange={onModelChange}
									onEffortChange={onEffortChange}
								/>
							)}
							<ContextGauge sessionKey={sessionKey} />
							<HeartbeatIndicator />
						</div>
						<button
							type="button"
							disabled={!actionButtonEnabled}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => {
								if (interruptible) {
									interrupt();
									return;
								}
								void submitValue();
							}}
							aria-label={actionButtonLabel}
							className={`p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
								actionButtonEnabled
									? interruptible
										? "text-danger hover:text-ember"
										: "text-brand hover:text-ember"
									: "text-dark-400 hover:text-dark-200"
							}`}
						>
							{interruptible ? <CircleStop size={18} /> : <Send size={18} />}
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
