import type { DisplayImage, ImageMediaType } from "../../../common/protocol.ts";

export interface ComposerImageAttachment {
	file: File;
	id: string;
	image: Extract<DisplayImage, { kind: "inline" }>;
}

export function filterSupportedImageFiles(files: File[]): File[] {
	return files.filter((file) => isSupportedImageType(file.type));
}

export async function createComposerImageAttachment(
	file: File,
): Promise<ComposerImageAttachment> {
	if (!isSupportedImageType(file.type)) {
		throw new Error(`Unsupported image type: ${file.type || "(empty)"}`);
	}

	return {
		file,
		id: createAttachmentId(),
		image: {
			kind: "inline",
			mediaType: file.type,
			base64: encodeBase64(new Uint8Array(await file.arrayBuffer())),
		},
	};
}

function isSupportedImageType(type: string): type is ImageMediaType {
	return (
		type === "image/jpeg" ||
		type === "image/png" ||
		type === "image/gif" ||
		type === "image/webp"
	);
}

function createAttachmentId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}

	return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function encodeBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes).toString("base64");
	}

	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}
