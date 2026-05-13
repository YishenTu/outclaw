export function jsonError(message: string, status: number) {
	return Response.json(
		{
			error: message,
		},
		{ status },
	);
}

export async function readFileWriteRequest(req: Request): Promise<
	| {
			ok: true;
			body: {
				content: string;
				expectedMtimeMs: number;
				expectedSha256: string;
			};
	  }
	| { ok: false; message: string; status: number }
> {
	const maxBodyBytes = 1024 * 1024;
	const contentLength = req.headers.get("content-length");
	if (contentLength) {
		const declaredBytes = Number.parseInt(contentLength, 10);
		if (
			!Number.isFinite(declaredBytes) ||
			declaredBytes < 0 ||
			declaredBytes > maxBodyBytes
		) {
			return { ok: false, message: "File write body too large", status: 413 };
		}
	}

	const bytes = new Uint8Array(await req.arrayBuffer());
	if (bytes.byteLength > maxBodyBytes) {
		return { ok: false, message: "File write body too large", status: 413 };
	}

	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return { ok: false, message: "Malformed file write body", status: 400 };
	}

	if (!isFileWriteBody(body)) {
		return { ok: false, message: "Malformed file write body", status: 400 };
	}

	return { ok: true, body };
}

export function createSseResponse<
	T extends { sequence: number; providerId: string; sdkSessionId: string },
>(iterable: AsyncIterable<T>, signal: AbortSignal): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const abort = () => {
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			if (signal.aborted) {
				abort();
				return;
			}
			signal.addEventListener("abort", abort, { once: true });
			try {
				for await (const item of iterable) {
					if (signal.aborted) {
						return;
					}
					const payload = `id: ${item.sequence}\ndata: ${JSON.stringify(
						item,
					)}\n\n`;
					controller.enqueue(encoder.encode(payload));
				}
			} catch (err) {
				if (!signal.aborted) {
					const message = err instanceof Error ? err.message : String(err);
					const payload = `event: error\ndata: ${JSON.stringify({
						message,
					})}\n\n`;
					try {
						controller.enqueue(encoder.encode(payload));
					} catch {
						// stream already closed
					}
				}
			} finally {
				signal.removeEventListener("abort", abort);
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		},
	});
}

function isFileWriteBody(value: unknown): value is {
	content: string;
	expectedMtimeMs: number;
	expectedSha256: string;
} {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		typeof value.content === "string" &&
		"expectedMtimeMs" in value &&
		typeof value.expectedMtimeMs === "number" &&
		Number.isFinite(value.expectedMtimeMs) &&
		"expectedSha256" in value &&
		typeof value.expectedSha256 === "string"
	);
}
