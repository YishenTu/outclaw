export interface InPlaceFileHandle {
	truncate(size: number): Promise<void>;
	write(
		buffer: Uint8Array,
		offset: number,
		length: number,
		position: number,
	): Promise<{ bytesWritten: number }>;
}

export async function writeFileContentInPlace(
	file: InPlaceFileHandle,
	content: string,
	options: { restoreContent?: Uint8Array } = {},
): Promise<void> {
	try {
		const bytes = new TextEncoder().encode(content);
		await writeBytes(file, bytes);
		await file.truncate(bytes.byteLength);
	} catch (error) {
		if (!options.restoreContent) {
			throw error;
		}
		try {
			await writeBytes(file, options.restoreContent);
			await file.truncate(options.restoreContent.byteLength);
		} catch (restoreError) {
			throw new AggregateError(
				[error, restoreError],
				"Failed to write file content and restore original content",
			);
		}
		throw error;
	}
}

async function writeBytes(
	file: InPlaceFileHandle,
	bytes: Uint8Array,
): Promise<void> {
	let offset = 0;

	while (offset < bytes.byteLength) {
		const { bytesWritten } = await file.write(
			bytes,
			offset,
			bytes.byteLength - offset,
			offset,
		);
		if (bytesWritten <= 0) {
			throw new Error("Failed to write file content");
		}
		offset += bytesWritten;
	}
}
