import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EffortLevel } from "../../../../common/commands.ts";
import type { ModelAlias } from "../../../../common/models.ts";
import { useWs } from "../../contexts/websocket-context.tsx";
import { useRuntimePopupStore } from "../../stores/runtime-popup.ts";
import type { CommandEntry } from "../../stores/slash-commands.ts";
import { useSlashCommandsStore } from "../../stores/slash-commands.ts";
import { ContextGauge } from "./context-gauge.tsx";
import { HeartbeatIndicator } from "./heartbeat-indicator.tsx";
import { handleMessageInputKeydown } from "./message-input-keydown.ts";
import { ModelSelector } from "./model-selector.tsx";
import { RuntimeCommandPopup } from "./runtime-command-popup.tsx";
import { useRuntimePopupShortcuts } from "./runtime-popup-shortcuts.ts";
import { SlashCommandMenu } from "./slash-command-menu.tsx";

interface MessageInputProps {
	onSend: (text: string) => boolean;
	disabled?: boolean;
	interruptible?: boolean;
	sessionKey?: string | null;
	model: string | null;
	effort: string | null;
	onModelChange: (model: ModelAlias) => boolean;
	onEffortChange: (effort: EffortLevel) => boolean;
	headerSlot?: React.ReactNode;
	compact?: boolean;
}

function isSlashAutocompleteInput(value: string): boolean {
	return value.startsWith("/") && !value.includes(" ") && !value.includes("\n");
}

function filterSlashCommands(value: string, commands: CommandEntry[]) {
	if (!isSlashAutocompleteInput(value)) {
		return [];
	}

	const filter = value.slice(1).toLowerCase();
	return commands.filter((command) =>
		command.name.toLowerCase().startsWith(filter),
	);
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
	headerSlot,
	compact = false,
}: MessageInputProps) {
	const { sendCommand } = useWs();
	const [value, setValue] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const isComposingRef = useRef(false);
	const commands = useSlashCommandsStore((state) => state.commands);
	const runtimePopup = useRuntimePopupStore((state) => state.popup);
	const closeRuntimePopup = useRuntimePopupStore((state) => state.closePopup);
	const filteredCommands = filterSlashCommands(value, commands);
	const showSlashMenu = filteredCommands.length > 0;
	const canSend = !disabled && value.trim() !== "";
	const runtimePopupItemCount =
		runtimePopup?.kind === "agent"
			? runtimePopup.agents.length
			: runtimePopup?.kind === "session"
				? runtimePopup.sessions.length
				: 0;

	function focusTextarea() {
		window.requestAnimationFrame(() => {
			textareaRef.current?.focus();
		});
	}

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

	function applySlashCommand(name: string) {
		closeRuntimePopup();
		setValue(`/${name} `);
		setSelectedIndex(0);
		focusTextarea();
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

	function submitValue() {
		if (canSend && onSend(value)) {
			closeRuntimePopup();
			setValue("");
			setSelectedIndex(0);
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
					<div className={`relative ${compact ? "h-[64px]" : "h-[115px]"}`}>
						<textarea
							ref={textareaRef}
							value={value}
							disabled={disabled}
							onChange={(event) => setValue(event.target.value)}
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
										submitValue,
									},
								);
							}}
							placeholder="Type a message..."
							className="h-full w-full resize-none bg-transparent px-2 pt-1 text-sm text-dark-100 placeholder:text-dark-500"
						/>
					</div>
					<div className="flex items-center justify-between gap-3 px-1 pt-1">
						<div className="flex min-w-0 items-center gap-1 overflow-visible">
							<ModelSelector
								model={model}
								effort={effort}
								disabled={disabled}
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
							onClick={submitValue}
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
