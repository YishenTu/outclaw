import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EffortLevel } from "../../../../../common/commands.ts";
import {
	detectMentionToken,
	matchMentionEntries,
	replaceMentionToken,
} from "../../../../../common/mention.ts";
import type { ModelAlias } from "../../../../../common/models.ts";
import type { WorkspaceFileEntry } from "../../../../../common/protocol.ts";
import {
	type ComposerImageAttachment,
	createComposerImageAttachment,
	filterSupportedImageFiles,
} from "../../../attachments/composer-images.ts";
import {
	type ComposerDraft,
	clearSubmittedDraftIfUnchanged,
	createEmptyComposerDraft,
} from "../../../chat/composer-draft.ts";
import { useWs } from "../../../contexts/websocket-context.tsx";
import { useAgentFilesStore } from "../../../stores/agent-files.ts";
import { useAgentsStore } from "../../../stores/agents.ts";
import { useComposerDraftsStore } from "../../../stores/composer-drafts.ts";
import { useRuntimePopupStore } from "../../../stores/runtime-popup.ts";
import { useSlashCommandsStore } from "../../../stores/slash-commands.ts";
import { ContextGauge } from "../context-gauge.tsx";
import { useGlobalStopShortcut } from "../global-stop-shortcut.ts";
import { HeartbeatIndicator } from "../heartbeat-indicator.tsx";
import { getImageThumbnailClassName } from "../image-thumbnail-styles.ts";
import { MentionMenu } from "../mention-menu.tsx";
import { ModelSelector } from "../model-selector.tsx";
import { RuntimeCommandPopup } from "../runtime-command-popup.tsx";
import { useRuntimePopupShortcuts } from "../runtime-popup-shortcuts.ts";
import { SlashCommandMenu } from "../slash-command-menu.tsx";
import {
	canSubmitMessageInput,
	filterSlashCommands,
	resolveRuntimePopupItemCount,
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
	model: string | null;
	effort: string | null;
	onModelChange: (model: ModelAlias) => boolean;
	onEffortChange: (effort: EffortLevel) => boolean;
	draftKey?: string | null;
	headerSlot?: React.ReactNode;
	compact?: boolean;
}

export function MessageInput({
	onSend,
	disabled = false,
	interruptible = false,
	sessionKey = null,
	model,
	effort,
	onModelChange,
	onEffortChange,
	draftKey = null,
	headerSlot,
	compact = false,
}: MessageInputProps) {
	const { sendCommand } = useWs();
	const initialDraft = useRef<ComposerDraft>(
		draftKey
			? useComposerDraftsStore.getState().getDraft(draftKey)
			: createEmptyComposerDraft(),
	);
	const [value, setValue] = useState(initialDraft.current.text);
	const [cursor, setCursor] = useState(0);
	const [images, setImages] = useState<ComposerImageAttachment[]>(
		initialDraft.current.images,
	);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
	const [mentionDismissed, setMentionDismissed] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const isComposingRef = useRef(false);
	const draftKeyRef = useRef<string | null>(draftKey);
	const draftRef = useRef<ComposerDraft>(initialDraft.current);
	const setPersistedDraft = useComposerDraftsStore((state) => state.setDraft);
	const commands = useSlashCommandsStore((state) => state.commands);
	const runtimePopup = useRuntimePopupStore((state) => state.popup);
	const closeRuntimePopup = useRuntimePopupStore((state) => state.closePopup);
	const activeAgentId = useAgentsStore((state) => state.activeAgentId);
	const agentFilesEntry = useAgentFilesStore((state) =>
		activeAgentId ? state.entriesByAgent[activeAgentId] : undefined,
	);
	const agentFiles = agentFilesEntry?.files ?? EMPTY_FILES;
	const requestAgentFiles = useAgentFilesStore((state) => state.requestFiles);
	const mentionToken = detectMentionToken(value, cursor);
	const mentionMatches: WorkspaceFileEntry[] = mentionToken
		? matchMentionEntries(agentFiles, mentionToken.query, {
				limit: MAX_MENTION_RESULTS,
			})
		: [];
	const showMentionMenu =
		mentionToken !== null && mentionMatches.length > 0 && !mentionDismissed;
	const filteredCommands = filterSlashCommands(value, commands);
	const showSlashMenu = !showMentionMenu && filteredCommands.length > 0;
	const canSend = canSubmitMessageInput({
		disabled,
		imageCount: images.length,
		submitting,
		value,
	});
	const isInputDisabled = disabled || submitting;
	const runtimePopupItemCount = resolveRuntimePopupItemCount(runtimePopup);

	function focusTextarea() {
		window.requestAnimationFrame(() => {
			textareaRef.current?.focus();
		});
	}

	useGlobalStopShortcut(interruptible, () => sendCommand("/stop"));

	useRuntimePopupShortcuts(runtimePopup, {
		selectedIndex,
		setSelectedIndex,
		selectIndex: (index) => {
			selectRuntimePopupItem(index);
		},
		closePopup: closeRuntimePopup,
		onDismiss: focusTextarea,
	});

	useEffect(() => {
		if (!runtimePopup) {
			return;
		}

		textareaRef.current?.blur();
	}, [runtimePopup]);

	useEffect(() => {
		if (draftKeyRef.current === draftKey) {
			return;
		}

		const nextDraft = draftKey
			? useComposerDraftsStore.getState().getDraft(draftKey)
			: createEmptyComposerDraft();
		draftKeyRef.current = draftKey;
		draftRef.current = nextDraft;
		setValue(nextDraft.text);
		setImages(nextDraft.images);
		setCursor(nextDraft.text.length);
		setSelectedIndex(0);
		setMentionSelectedIndex(0);
		setMentionDismissed(false);
	}, [draftKey]);

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
		if (!activeAgentId) {
			return;
		}
		if (!value.includes("@")) {
			return;
		}
		void requestAgentFiles(activeAgentId);
	}, [activeAgentId, requestAgentFiles, value]);

	function syncCursorFromTextarea() {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		setCursor(textarea.selectionStart ?? value.length);
	}

	function replaceDraft(nextDraft: ComposerDraft) {
		draftRef.current = nextDraft;
		setValue(nextDraft.text);
		setImages(nextDraft.images);
		if (draftKey) {
			setPersistedDraft(draftKey, nextDraft);
		}
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

	function applySlashCommand(name: string) {
		closeRuntimePopup();
		replaceDraftText(`/${name} `);
		setCursor(`/${name} `.length);
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
			if (session && sendCommand(`/session ${session.sdkSessionId}`)) {
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
		<div className="p-4">
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
							onSelect={(command) => applySlashCommand(command.name)}
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
					<div className={`relative ${compact ? "h-[64px]" : "h-[115px]"}`}>
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
								const files = filterSupportedImageFiles(
									Array.from(event.dataTransfer.files),
								);
								if (files.length === 0) {
									return;
								}

								event.preventDefault();
							}}
							onDrop={(event) => {
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
												applySlashCommand(selectedCommand.name);
											}
										},
										sendStopCommand: () => sendCommand("/stop"),
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
							placeholder="Type a message or paste/drop an image..."
							className="scrollbar-none h-full w-full resize-none bg-transparent px-2 pt-1 text-sm text-dark-100 placeholder:text-dark-500"
						/>
					</div>
					<div className="flex items-center justify-between gap-3 px-1 pt-1">
						<div className="flex min-w-0 items-center gap-1 overflow-visible">
							<ModelSelector
								model={model}
								effort={effort}
								disabled={isInputDisabled}
								onModelChange={onModelChange}
								onEffortChange={onEffortChange}
							/>
							<ContextGauge sessionKey={sessionKey} />
							<HeartbeatIndicator />
						</div>
						<button
							type="button"
							disabled={!canSend}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => {
								void submitValue();
							}}
							className={`p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
								canSend
									? "text-brand hover:text-ember"
									: "text-dark-400 hover:text-dark-200"
							}`}
						>
							<Send size={18} />
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
