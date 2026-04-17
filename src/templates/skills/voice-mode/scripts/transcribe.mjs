import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
	exitCodeForError,
	messageForError,
	VoiceToolError,
} from "./errors.mjs";
import { createGeminiClient, withGenerateRetry } from "./gemini-client.mjs";
import { resolveAudioMime } from "./mime.mjs";

export const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_PROMPT =
	'Transcribe the audio verbatim. Output only the transcript — no commentary, no timestamps, no surrounding quotes. If two or more distinct speakers are clearly present, prefix each line with "Speaker 1:", "Speaker 2:", etc.; otherwise output the plain transcript with no speaker labels.';

export async function runVoiceTranscribe(argv, deps = {}) {
	const stdout = deps.stdout ?? process.stdout;
	const stderr = deps.stderr ?? process.stderr;
	const env = deps.env ?? process.env;
	const sleep =
		deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const now = deps.now ?? (() => Date.now());

	try {
		const parsed = parseArgs(argv);
		const filePath = parsed.path;
		if (!filePath) {
			throw new VoiceToolError(
				"Usage: node ./skills/voice-mode/scripts/transcribe.mjs <path> [--model <id>] [--language <code>] [--prompt <instr>] [--max-bytes <n>] [--timeout-ms <n>] [--no-delete]",
			);
		}

		const fileStat = await stat(filePath);
		if (!fileStat.isFile()) {
			throw new VoiceToolError(`not a regular file: ${filePath}`);
		}
		if (fileStat.size > parsed.maxBytes) {
			throw new VoiceToolError(
				`file exceeds max size (${parsed.maxBytes} bytes)`,
				3,
			);
		}

		const apiKey = env.GEMINI_API_KEY;
		if (!apiKey) {
			throw new VoiceToolError("GEMINI_API_KEY is required", 2);
		}

		const prompt =
			parsed.language && parsed.language !== "auto"
				? `${parsed.prompt}\nLanguage hint: ${parsed.language}`
				: parsed.prompt;
		const mimeType = resolveAudioMime(filePath);
		const client = createGeminiClient({
			apiKey,
			fetch: deps.fetch,
			now,
			sleep,
		});

		const result = await withTimeout(
			(async () => {
				let uploadedFile;
				try {
					uploadedFile = await client.uploadFile({ path: filePath, mimeType });
					const activeFile = await client.waitUntilActive(
						uploadedFile.name,
						30_000,
					);
					const response = await withGenerateRetry(
						() =>
							client.generateContent({
								model: parsed.model,
								contents: [
									{
										parts: [
											{ text: prompt },
											{
												file_data: {
													file_uri: activeFile.uri,
													mime_type: mimeType,
												},
											},
										],
									},
								],
							}),
						sleep,
					);
					return extractTranscript(response);
				} finally {
					if (!parsed.noDelete && uploadedFile?.name) {
						await client.deleteFile(uploadedFile.name).catch(() => undefined);
					}
				}
			})(),
			parsed.timeoutMs,
		);

		if (result) {
			stdout.write(result);
		}
		return 0;
	} catch (error) {
		stderr.write(`${messageForError(error)}\n`);
		return exitCodeForError(error);
	}
}

export function parseArgs(argv) {
	const parsed = {
		path: undefined,
		model: DEFAULT_MODEL,
		language: "auto",
		prompt: DEFAULT_PROMPT,
		maxBytes: DEFAULT_MAX_BYTES,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		noDelete: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (!value) {
			continue;
		}
		if (!value.startsWith("--")) {
			if (parsed.path) {
				throw new VoiceToolError(`unexpected argument: ${value}`);
			}
			parsed.path = value;
			continue;
		}

		switch (value) {
			case "--model":
				parsed.model = readFlagValue(argv, ++index, value);
				break;
			case "--language":
				parsed.language = readFlagValue(argv, ++index, value);
				break;
			case "--prompt":
				parsed.prompt = readFlagValue(argv, ++index, value);
				break;
			case "--max-bytes":
				parsed.maxBytes = parseIntegerFlag(
					readFlagValue(argv, ++index, value),
					value,
				);
				break;
			case "--timeout-ms":
				parsed.timeoutMs = parseIntegerFlag(
					readFlagValue(argv, ++index, value),
					value,
				);
				break;
			case "--no-delete":
				parsed.noDelete = true;
				break;
			default:
				throw new VoiceToolError(`unknown flag: ${value}`);
		}
	}

	return parsed;
}

export function extractTranscript(response) {
	const parts = response?.candidates?.[0]?.content?.parts ?? [];
	return parts
		.map((part) => (typeof part?.text === "string" ? part.text : ""))
		.join("")
		.trim();
}

async function withTimeout(promise, timeoutMs) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					reject(new VoiceToolError("transcription timed out", 4));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

function readFlagValue(argv, index, flag) {
	const value = argv[index];
	if (!value || value.startsWith("--")) {
		throw new VoiceToolError(`missing value for ${flag}`);
	}
	return value;
}

function parseIntegerFlag(value, flag) {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || `${parsed}` !== value) {
		throw new VoiceToolError(`invalid ${flag} value: ${value}`);
	}
	return parsed;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const exitCode = await runVoiceTranscribe(process.argv.slice(2));
	process.exit(exitCode);
}
