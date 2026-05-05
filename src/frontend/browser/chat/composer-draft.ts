import type { ComposerImageAttachment } from "../attachments/composer-images.ts";

export interface ComposerDraft {
	text: string;
	images: ComposerImageAttachment[];
}

export function createEmptyComposerDraft(): ComposerDraft {
	return {
		text: "",
		images: [],
	};
}

export function clearSubmittedDraftIfUnchanged(
	current: ComposerDraft,
	submitted: ComposerDraft,
): ComposerDraft {
	if (
		current.text !== submitted.text ||
		!hasSameAttachmentIds(current.images, submitted.images)
	) {
		return current;
	}

	return createEmptyComposerDraft();
}

function hasSameAttachmentIds(
	current: ComposerImageAttachment[],
	submitted: ComposerImageAttachment[],
): boolean {
	return (
		current.length === submitted.length &&
		current.every((image, index) => image.id === submitted[index]?.id)
	);
}
