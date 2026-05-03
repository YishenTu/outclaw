export interface MessageInputKeyEvent {
	key?: string;
	shiftKey?: boolean;
	keyCode?: number;
	nativeEvent?: {
		isComposing?: boolean;
		keyCode?: number;
	};
	preventDefault: () => void;
}

interface MessageInputKeydownState {
	showSlashMenu: boolean;
	filteredCommandCount: number;
	selectedIndex: number;
	interruptible: boolean;
	isComposing: boolean;
	showMentionMenu: boolean;
	mentionItemCount: number;
	mentionSelectedIndex: number;
}

interface MessageInputKeydownActions {
	setSelectedIndex: (index: number) => void;
	applySelectedSlashCommand: (index: number) => void;
	sendStopCommand: () => boolean;
	submitValue: () => void;
	setMentionSelectedIndex: (index: number) => void;
	applySelectedMention: (index: number) => void;
	dismissMentionMenu: () => void;
}

const IME_KEYCODE = 229;

function isImeConfirmationKeydown(
	event: MessageInputKeyEvent,
	isComposing: boolean,
): boolean {
	return (
		isComposing ||
		event.nativeEvent?.isComposing === true ||
		event.key === "Process" ||
		event.keyCode === IME_KEYCODE ||
		event.nativeEvent?.keyCode === IME_KEYCODE
	);
}

export function handleMessageInputKeydown(
	event: MessageInputKeyEvent,
	state: MessageInputKeydownState,
	actions: MessageInputKeydownActions,
): boolean {
	if (state.showMentionMenu && event.key === "ArrowDown") {
		event.preventDefault();
		actions.setMentionSelectedIndex(
			Math.min(state.mentionSelectedIndex + 1, state.mentionItemCount - 1),
		);
		return true;
	}

	if (state.showMentionMenu && event.key === "ArrowUp") {
		event.preventDefault();
		actions.setMentionSelectedIndex(
			Math.max(state.mentionSelectedIndex - 1, 0),
		);
		return true;
	}

	if (
		state.showMentionMenu &&
		(event.key === "Enter" || event.key === "Tab") &&
		event.shiftKey !== true
	) {
		if (isImeConfirmationKeydown(event, state.isComposing)) {
			return false;
		}

		event.preventDefault();
		actions.applySelectedMention(state.mentionSelectedIndex);
		return true;
	}

	if (state.showMentionMenu && event.key === "Escape") {
		event.preventDefault();
		actions.dismissMentionMenu();
		return true;
	}

	if (state.showSlashMenu && event.key === "ArrowDown") {
		event.preventDefault();
		actions.setSelectedIndex(
			Math.min(state.selectedIndex + 1, state.filteredCommandCount - 1),
		);
		return true;
	}

	if (state.showSlashMenu && event.key === "ArrowUp") {
		event.preventDefault();
		actions.setSelectedIndex(Math.max(state.selectedIndex - 1, 0));
		return true;
	}

	if (
		state.showSlashMenu &&
		(event.key === "Enter" || event.key === "Tab") &&
		event.shiftKey !== true
	) {
		if (isImeConfirmationKeydown(event, state.isComposing)) {
			return false;
		}

		event.preventDefault();
		actions.applySelectedSlashCommand(state.selectedIndex);
		return true;
	}

	if (event.key === "Escape") {
		if (state.interruptible && actions.sendStopCommand()) {
			event.preventDefault();
			return true;
		}

		return false;
	}

	if (event.key === "Enter" && event.shiftKey !== true) {
		if (isImeConfirmationKeydown(event, state.isComposing)) {
			return false;
		}

		event.preventDefault();
		actions.submitValue();
		return true;
	}

	return false;
}
