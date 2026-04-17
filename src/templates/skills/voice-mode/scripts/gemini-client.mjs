import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { messageForError, VoiceToolError } from "./errors.mjs";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

export function createGeminiClient(opts) {
	const fetchImpl = opts.fetch ?? fetch;
	const now = opts.now ?? (() => Date.now());
	const sleep =
		opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;

	return {
		async uploadFile(params) {
			const uploadUrl = await startUpload(fetchImpl, {
				apiKey: opts.apiKey,
				baseUrl,
				displayName: basename(params.path),
				mimeType: params.mimeType,
			});
			assertGoogleHost(uploadUrl);

			const bytes = await readFile(params.path);
			const response = await requestJson(fetchImpl, uploadUrl, {
				method: "POST",
				headers: {
					"Content-Length": String(bytes.byteLength),
					"X-Goog-Upload-Command": "upload, finalize",
					"X-Goog-Upload-Offset": "0",
				},
				body: bytes,
			});
			return response.file ?? response;
		},

		async waitUntilActive(name, timeoutMs) {
			const deadline = now() + timeoutMs;
			const resourcePath = name.startsWith("files/") ? name : `files/${name}`;
			while (true) {
				const response = await requestJson(
					fetchImpl,
					`${baseUrl}/v1beta/${resourcePath}?key=${encodeURIComponent(opts.apiKey)}`,
					{ method: "GET" },
				);
				const file = response.file ?? response;
				if (file?.state === "ACTIVE") {
					return file;
				}
				if (file?.state === "FAILED") {
					throw new VoiceToolError("Gemini rejected the uploaded audio", 3);
				}
				if (now() >= deadline) {
					throw new VoiceToolError("upload timed out", 4);
				}
				await sleep(1000);
			}
		},

		async generateContent(params) {
			return requestJson(
				fetchImpl,
				`${baseUrl}/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						contents: params.contents,
					}),
				},
			);
		},

		async deleteFile(name) {
			const resourcePath = name.startsWith("files/") ? name : `files/${name}`;
			await requestJson(
				fetchImpl,
				`${baseUrl}/v1beta/${resourcePath}?key=${encodeURIComponent(opts.apiKey)}`,
				{ method: "DELETE" },
			);
		},
	};
}

async function startUpload(fetchImpl, params) {
	const response = await fetchImpl(
		`${params.baseUrl}/upload/v1beta/files?key=${encodeURIComponent(params.apiKey)}`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Goog-Upload-Protocol": "resumable",
				"X-Goog-Upload-Command": "start",
				"X-Goog-Upload-Header-Content-Type": params.mimeType,
			},
			body: JSON.stringify({
				file: {
					display_name: params.displayName,
				},
			}),
			redirect: "manual",
		},
	);

	if (!response.ok) {
		throw await errorFromResponse(response);
	}

	const uploadUrl = response.headers.get("x-goog-upload-url");
	if (!uploadUrl) {
		throw new VoiceToolError("Gemini upload URL missing from response");
	}
	return uploadUrl;
}

async function requestJson(fetchImpl, url, init) {
	const response = await fetchImpl(url, {
		...init,
		redirect: "manual",
	});
	if (isRedirect(response.status)) {
		const location = response.headers.get("location");
		if (!location) {
			throw new VoiceToolError("redirect response missing location header");
		}
		assertGoogleHost(location);
		return requestJson(fetchImpl, location, init);
	}
	if (!response.ok) {
		throw await errorFromResponse(response, url);
	}
	if (response.status === 204) {
		return {};
	}
	return response.json();
}

async function errorFromResponse(response, requestUrl) {
	const text = await response.text();
	const pathHint = describeRequestPath(requestUrl);
	let message = pathHint
		? `Gemini API error (${response.status}) for ${pathHint}`
		: `Gemini API error (${response.status})`;
	try {
		const parsed = JSON.parse(text);
		const parsedMessage = parsed?.error?.message;
		if (typeof parsedMessage === "string" && parsedMessage.length > 0) {
			message = parsedMessage;
		} else if (text.trim()) {
			message = `${message}: ${truncate(text.trim(), 200)}`;
		}
	} catch {
		if (text.trim()) {
			message = `${message}: ${truncate(text.trim(), 200)}`;
		}
	}

	if (response.status === 401 || response.status === 403) {
		return new VoiceToolError(message, 2);
	}
	if (response.status === 408) {
		return new VoiceToolError(message, 4);
	}
	if (
		response.status === 400 &&
		/unsupported|invalid|codec|mime|format/i.test(message)
	) {
		return new VoiceToolError(message, 3);
	}
	if (response.status >= 500) {
		const error = new Error(message);
		error.status = response.status;
		return error;
	}
	return new VoiceToolError(message);
}

function isRedirect(status) {
	return status >= 300 && status < 400;
}

function describeRequestPath(requestUrl) {
	if (!requestUrl) {
		return "";
	}
	try {
		const parsed = new URL(String(requestUrl));
		return parsed.pathname;
	} catch {
		return "";
	}
}

function truncate(value, max) {
	if (value.length <= max) {
		return value;
	}
	return `${value.slice(0, max)}…`;
}

function assertGoogleHost(url) {
	const parsed = new URL(url);
	if (
		parsed.hostname !== "generativelanguage.googleapis.com" &&
		!parsed.hostname.endsWith(".googleapis.com")
	) {
		throw new VoiceToolError(
			`refusing redirect to non-Google host: ${parsed.hostname}`,
		);
	}
}

export async function withGenerateRetry(runGenerate, sleepImpl) {
	let lastError;
	for (const delayMs of [0, 1000, 3000]) {
		if (delayMs > 0) {
			await sleepImpl(delayMs);
		}
		try {
			return await runGenerate();
		} catch (error) {
			if (
				!(error instanceof Error) ||
				typeof error.status !== "number" ||
				error.status < 500
			) {
				throw error;
			}
			lastError = error;
		}
	}
	throw new VoiceToolError(messageForError(lastError));
}
