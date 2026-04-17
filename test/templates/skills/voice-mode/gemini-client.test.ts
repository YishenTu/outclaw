import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceToolError } from "../../../../src/templates/skills/voice-mode/scripts/errors.mjs";
import {
	createGeminiClient,
	withGenerateRetry,
} from "../../../../src/templates/skills/voice-mode/scripts/gemini-client.mjs";

const tmpRoots: string[] = [];

afterEach(() => {
	for (const root of tmpRoots) {
		rmSync(root, { force: true, recursive: true });
	}
	tmpRoots.length = 0;
});

describe("createGeminiClient", () => {
	test("uploadFile performs resumable upload with Gemini headers", async () => {
		const root = mkdtempSync(join(tmpdir(), "voice-skill-"));
		tmpRoots.push(root);
		const filePath = join(root, "note.oga");
		writeFileSync(filePath, "voice-bytes");

		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = mock(async (url: string | URL, init?: RequestInit) => {
			requests.push({ url: String(url), init });
			if (requests.length === 1) {
				return new Response("", {
					status: 200,
					headers: {
						"x-goog-upload-url":
							"https://generativelanguage.googleapis.com/upload/resumable/files/123",
					},
				});
			}
			return Response.json({
				file: {
					name: "files/123",
					uri: "gs://files/123",
				},
			});
		});

		const client = createGeminiClient({
			apiKey: "api-key",
			fetch: fetchImpl as unknown as typeof fetch,
		});
		const file = await client.uploadFile({
			path: filePath,
			mimeType: "audio/ogg",
		});

		expect(file).toEqual({
			name: "files/123",
			uri: "gs://files/123",
		});
		expect(requests[0]?.url).toContain("/upload/v1beta/files?key=api-key");
		expect(requests[0]?.init?.headers).toMatchObject({
			"X-Goog-Upload-Protocol": "resumable",
			"X-Goog-Upload-Command": "start",
			"X-Goog-Upload-Header-Content-Type": "audio/ogg",
		});
		expect(requests[1]?.url).toContain("/upload/resumable/files/123");
		expect(requests[1]?.init?.headers).toMatchObject({
			"X-Goog-Upload-Command": "upload, finalize",
			"X-Goog-Upload-Offset": "0",
		});
	});

	test("waitUntilActive polls until the uploaded file becomes ACTIVE", async () => {
		let callCount = 0;
		const sleep = mock(async (_ms: number) => undefined);
		const client = createGeminiClient({
			apiKey: "api-key",
			fetch: mock(async () => {
				callCount += 1;
				if (callCount === 1) {
					return Response.json({
						file: { name: "files/1", state: "PROCESSING" },
					});
				}
				return Response.json({
					file: {
						name: "files/1",
						state: "ACTIVE",
						uri: "gs://files/1",
					},
				});
			}) as unknown as typeof fetch,
			sleep,
			now: () => 0,
		});

		const file = await client.waitUntilActive("files/1", 30_000);

		expect(file).toEqual({
			name: "files/1",
			state: "ACTIVE",
			uri: "gs://files/1",
		});
		expect(sleep).toHaveBeenCalledWith(1000);
	});

	test("maps auth failures to exit code 2", async () => {
		const client = createGeminiClient({
			apiKey: "api-key",
			fetch: mock(async () =>
				Response.json(
					{ error: { message: "invalid api key" } },
					{ status: 401 },
				),
			) as unknown as typeof fetch,
		});

		await expect(
			client.generateContent({
				model: "gemini-3.1-flash-lite-preview",
				contents: [],
			}),
		).rejects.toMatchObject({
			exitCode: 2,
			message: "invalid api key",
		});
	});
});

describe("withGenerateRetry", () => {
	test("retries 5xx responses with exponential backoff", async () => {
		let attempts = 0;
		const sleep = mock(async (_ms: number) => undefined);

		const result = await withGenerateRetry(async () => {
			attempts += 1;
			if (attempts < 3) {
				const error = new Error("temporary");
				Object.assign(error, { status: 503 });
				throw error;
			}
			return { ok: true };
		}, sleep);

		expect(result).toEqual({ ok: true });
		expect(sleep.mock.calls).toEqual([[1000], [3000]]);
	});

	test("wraps exhausted 5xx retries into a VoiceToolError", async () => {
		const sleep = mock(async (_ms: number) => undefined);

		await expect(
			withGenerateRetry(async () => {
				const error = new Error("still failing");
				Object.assign(error, { status: 503 });
				throw error;
			}, sleep),
		).rejects.toBeInstanceOf(VoiceToolError);
	});
});
