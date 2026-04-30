import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	exitCodeForError,
	VoiceToolError,
} from "../../src/templates/skills/voice-mode/scripts/errors.mjs";
import {
	createGeminiClient,
	withGenerateRetry,
} from "../../src/templates/skills/voice-mode/scripts/gemini-client.mjs";
import { resolveAudioMime } from "../../src/templates/skills/voice-mode/scripts/mime.mjs";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MODEL,
	DEFAULT_PROMPT,
	DEFAULT_TIMEOUT_MS,
	extractTranscript,
	parseArgs,
	runVoiceTranscribe,
	withTimeout,
} from "../../src/templates/skills/voice-mode/scripts/transcribe.mjs";

let tmp: string;
const VOICE_SKILL_PATH = join(
	import.meta.dir,
	"../../src/templates/skills/voice-mode/SKILL.md",
);

interface ParsedVoiceArgs {
	language: string;
	maxBytes: number;
	model: string;
	noDelete: boolean;
	path?: string;
	prompt: string;
	timeoutMs: number;
}

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "outclaw-voice-mode-"));
});

afterEach(() => {
	rmSync(tmp, { force: true, recursive: true });
});

function response(body: string, init: ResponseInit): Response {
	return new Response(body, init);
}

function writableBuffer() {
	let value = "";
	return {
		stream: {
			write(chunk: string) {
				value += chunk;
			},
		},
		value() {
			return value;
		},
	};
}

function parseVoiceArgs(argv: string[]): ParsedVoiceArgs {
	return parseArgs(argv) as ParsedVoiceArgs;
}

describe("voice-mode fallback script", () => {
	test("documents the shipped Telegram audio segment and fallback helper contract", () => {
		const skill = readFileSync(VOICE_SKILL_PATH, "utf-8");

		expect(skill).toContain("[audio: /abs/path/file.oga]");
		expect(skill).toContain("[audio: /abs/path/file.mp3]");
		expect(skill).toContain(
			"node ./skills/voice-mode/scripts/transcribe.mjs <ABSOLUTE_AUDIO_PATH>",
		);
		expect(skill).toContain("GEMINI_API_KEY");
		expect(skill).toContain("I couldn't make out the audio message");
		expect(skill).not.toContain("[voice note");
	});

	test("parses arguments into the transcription contract", () => {
		expect(parseVoiceArgs(["/tmp/a.oga"])).toEqual({
			path: "/tmp/a.oga",
			model: DEFAULT_MODEL,
			language: "auto",
			prompt: DEFAULT_PROMPT,
			maxBytes: DEFAULT_MAX_BYTES,
			timeoutMs: DEFAULT_TIMEOUT_MS,
			noDelete: false,
		});
		expect(
			parseVoiceArgs([
				"/tmp/a.oga",
				"--model",
				"gemini-test",
				"--language",
				"zh",
				"--prompt",
				"plain text",
				"--max-bytes",
				"9",
				"--timeout-ms",
				"10",
				"--no-delete",
			]),
		).toEqual({
			path: "/tmp/a.oga",
			model: "gemini-test",
			language: "zh",
			prompt: "plain text",
			maxBytes: 9,
			timeoutMs: 10,
			noDelete: true,
		});
	});

	test("rejects malformed arguments and unsupported audio inputs", () => {
		expect(() => parseArgs(["/tmp/a.oga", "/tmp/b.oga"])).toThrow(
			"unexpected argument: /tmp/b.oga",
		);
		expect(() => parseArgs(["/tmp/a.oga", "--model"])).toThrow(
			"missing value for --model",
		);
		expect(() => parseArgs(["/tmp/a.oga", "--max-bytes", "1.5"])).toThrow(
			"invalid --max-bytes value: 1.5",
		);
		expect(resolveAudioMime("/tmp/a.oga")).toBe("audio/ogg");
		expect(resolveAudioMime("/tmp/a.unknown", "audio/webm")).toBe("audio/webm");

		try {
			resolveAudioMime("/tmp/a.txt");
			throw new Error("expected unsupported audio extension to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(VoiceToolError);
			expect(exitCodeForError(error)).toBe(3);
		}
	});

	test("classifies local validation failures before making network calls", async () => {
		const filePath = join(tmp, "note.oga");
		writeFileSync(filePath, "audio");
		const stdout = writableBuffer();
		const stderr = writableBuffer();

		expect(
			await runVoiceTranscribe([filePath], {
				env: {},
				stdout: stdout.stream,
				stderr: stderr.stream,
			}),
		).toBe(2);
		expect(stderr.value()).toContain("GEMINI_API_KEY is required");

		const oversized = writableBuffer();
		expect(
			await runVoiceTranscribe([filePath, "--max-bytes", "1"], {
				env: { GEMINI_API_KEY: "key" },
				stdout: stdout.stream,
				stderr: oversized.stream,
			}),
		).toBe(3);
		expect(oversized.value()).toContain("file exceeds max size");
	});

	test("extracts transcript text and applies timeout policy", async () => {
		expect(
			extractTranscript({
				candidates: [
					{
						content: {
							parts: [{ text: " hello " }, { text: "world\n" }, {}],
						},
					},
				],
			}),
		).toBe("hello world");

		await expect(withTimeout(new Promise(() => undefined), 1)).rejects.toThrow(
			"transcription timed out",
		);
	});

	test("retries generateContent only for transient server failures", async () => {
		const sleeps: number[] = [];
		let attempts = 0;
		const transient = new Error("server busy");
		(transient as Error & { status: number }).status = 503;

		await expect(
			withGenerateRetry(
				async () => {
					attempts += 1;
					if (attempts < 3) {
						throw transient;
					}
					return { ok: true };
				},
				async (ms: number) => {
					sleeps.push(ms);
				},
			),
		).resolves.toEqual({ ok: true });
		expect(attempts).toBe(3);
		expect(sleeps).toEqual([1000, 3000]);

		await expect(
			withGenerateRetry(
				async () => {
					throw new VoiceToolError("bad media", 3);
				},
				async () => undefined,
			),
		).rejects.toThrow("bad media");
	});

	test("restricts Gemini upload URLs and redirects to Google API hosts", async () => {
		const uploadClient = createGeminiClient({
			apiKey: "key",
			fetch: async () =>
				response("{}", {
					status: 200,
					headers: {
						"x-goog-upload-url": "https://evil.example/upload",
					},
				}),
		});

		await expect(
			uploadClient.uploadFile({
				path: join(tmp, "note.oga"),
				mimeType: "audio/ogg",
			}),
		).rejects.toThrow("refusing redirect to non-Google host: evil.example");

		const redirectClient = createGeminiClient({
			apiKey: "key",
			fetch: async () =>
				response("", {
					status: 302,
					headers: {
						location: "https://evil.example/delete",
					},
				}),
		});

		await expect(redirectClient.deleteFile("files/test")).rejects.toThrow(
			"refusing redirect to non-Google host: evil.example",
		);
	});
});
