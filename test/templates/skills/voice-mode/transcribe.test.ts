import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_PROMPT,
	parseArgs,
	runVoiceTranscribe,
} from "../../../../src/templates/skills/voice-mode/scripts/transcribe.mjs";

const tmpRoots: string[] = [];

afterEach(() => {
	for (const root of tmpRoots) {
		rmSync(root, { force: true, recursive: true });
	}
	tmpRoots.length = 0;
});

function createWriter() {
	let output = "";
	return {
		write(chunk: string) {
			output += chunk;
		},
		toString() {
			return output;
		},
	};
}

describe("parseArgs", () => {
	test("uses built-in defaults", () => {
		expect(parseArgs(["/tmp/note.oga"])).toMatchObject({
			path: "/tmp/note.oga",
			prompt: DEFAULT_PROMPT,
			language: "auto",
			noDelete: false,
		});
	});

	test("parses helper flags", () => {
		expect(
			parseArgs([
				"/tmp/note.oga",
				"--model",
				"gemini-custom",
				"--language",
				"en",
				"--prompt",
				"Transcribe this",
				"--max-bytes",
				"100",
				"--timeout-ms",
				"2000",
				"--no-delete",
			]),
		).toMatchObject({
			model: "gemini-custom",
			language: "en",
			prompt: "Transcribe this",
			maxBytes: 100,
			timeoutMs: 2000,
			noDelete: true,
		});
	});
});

describe("runVoiceTranscribe", () => {
	test("writes only the transcript to stdout on success", async () => {
		const root = mkdtempSync(join(tmpdir(), "voice-skill-"));
		tmpRoots.push(root);
		const filePath = join(root, "note.oga");
		writeFileSync(filePath, "voice-bytes");

		const stdout = createWriter();
		const stderr = createWriter();
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const exitCode = await runVoiceTranscribe([filePath], {
			env: { GEMINI_API_KEY: "api-key" },
			stdout,
			stderr,
			fetch: mock(async (url: string | URL, init?: RequestInit) => {
				requests.push({ url: String(url), init });
				if (String(url).includes("/upload/v1beta/files")) {
					return new Response("", {
						status: 200,
						headers: {
							"x-goog-upload-url":
								"https://generativelanguage.googleapis.com/upload/resumable/files/123",
						},
					});
				}
				if (String(url).includes("/upload/resumable/files/123")) {
					return Response.json({
						file: {
							name: "files/123",
							uri: "gs://files/123",
						},
					});
				}
				if (String(url).includes("/v1beta/files/123")) {
					if (init?.method === "DELETE") {
						return new Response("", { status: 204 });
					}
					return Response.json({
						file: {
							name: "files/123",
							state: "ACTIVE",
							uri: "gs://files/123",
						},
					});
				}
				if (String(url).includes(":generateContent")) {
					const body = JSON.parse(String(init?.body));
					expect(body.contents[0].parts[0].text).toBe(DEFAULT_PROMPT);
					expect(body.contents[0].parts[1].file_data).toEqual({
						file_uri: "gs://files/123",
						mime_type: "audio/ogg",
					});
					return Response.json({
						candidates: [
							{
								content: {
									parts: [{ text: "hello from transcript" }],
								},
							},
						],
					});
				}
				throw new Error(`unexpected fetch: ${String(url)}`);
			}) as unknown as typeof fetch,
		});

		expect(exitCode).toBe(0);
		expect(stdout.toString()).toBe("hello from transcript");
		expect(stderr.toString()).toBe("");
		expect(
			requests.some(({ url }) => url.includes("/v1beta/files/123")),
		).toBeTrue();
	});

	test("returns exit code 2 when GEMINI_API_KEY is missing", async () => {
		const root = mkdtempSync(join(tmpdir(), "voice-skill-"));
		tmpRoots.push(root);
		const filePath = join(root, "note.oga");
		writeFileSync(filePath, "voice-bytes");

		const stdout = createWriter();
		const stderr = createWriter();
		const exitCode = await runVoiceTranscribe([filePath], {
			env: {},
			stdout,
			stderr,
		});

		expect(exitCode).toBe(2);
		expect(stdout.toString()).toBe("");
		expect(stderr.toString()).toContain("GEMINI_API_KEY is required");
	});

	test("does not delete the uploaded file when --no-delete is passed", async () => {
		const root = mkdtempSync(join(tmpdir(), "voice-skill-"));
		tmpRoots.push(root);
		const filePath = join(root, "note.oga");
		writeFileSync(filePath, "voice-bytes");

		const deleteCalls: string[] = [];
		const exitCode = await runVoiceTranscribe([filePath, "--no-delete"], {
			env: { GEMINI_API_KEY: "api-key" },
			stdout: createWriter(),
			stderr: createWriter(),
			fetch: mock(async (url: string | URL, init?: RequestInit) => {
				if (String(url).includes("/upload/v1beta/files")) {
					return new Response("", {
						status: 200,
						headers: {
							"x-goog-upload-url":
								"https://generativelanguage.googleapis.com/upload/resumable/files/123",
						},
					});
				}
				if (String(url).includes("/upload/resumable/files/123")) {
					return Response.json({
						file: {
							name: "files/123",
							uri: "gs://files/123",
						},
					});
				}
				if (String(url).includes("/v1beta/files/123")) {
					if (init?.method === "DELETE") {
						deleteCalls.push(String(url));
						return new Response("", { status: 204 });
					}
					return Response.json({
						file: {
							name: "files/123",
							state: "ACTIVE",
							uri: "gs://files/123",
						},
					});
				}
				if (String(url).includes(":generateContent")) {
					return Response.json({
						candidates: [
							{
								content: {
									parts: [{ text: "kept file" }],
								},
							},
						],
					});
				}
				throw new Error(`unexpected fetch: ${String(url)}`);
			}) as unknown as typeof fetch,
		});

		expect(exitCode).toBe(0);
		expect(deleteCalls).toEqual([]);
	});
});
