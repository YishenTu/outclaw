import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { Type } from "typebox";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2_000;
const RESPONSE_READ_LIMIT_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const OUTCLAW_ENV_FILE_PATH = join(
	process.env.OUTCLAW_HOME || join(homedir(), ".outclaw"),
	".env",
);

const webSearchParams = Type.Object({
	query: Type.String({ description: "Search query" }),
	count: Type.Optional(
		Type.Number({
			description: "Number of results to return. Default 5, max 20.",
		}),
	),
	freshness: Type.Optional(
		Type.String({
			description:
				"Optional freshness filter: pd (past day), pw (past week), pm (past month), py (past year), or YYYY-MM-DDtoYYYY-MM-DD.",
		}),
	),
	country: Type.Optional(
		Type.String({ description: "Two-letter country code. Default US." }),
	),
	search_lang: Type.Optional(
		Type.String({ description: "Search language code. Default en." }),
	),
	safesearch: Type.Optional(
		Type.String({
			description:
				"Adult-content filter: off, moderate, or strict. Default moderate.",
		}),
	),
});

const webFetchParams = Type.Object({
	url: Type.String({ description: "HTTP or HTTPS URL to fetch" }),
	raw: Type.Optional(
		Type.Boolean({
			description:
				"Return raw text/HTML instead of extracting readable text from HTML. Default false.",
		}),
	),
});

interface TruncationResult {
	content: string;
	truncated: boolean;
	outputLines: number;
	totalLines: number;
	outputBytes: number;
	totalBytes: number;
}

interface BraveWebResult {
	title?: string;
	url?: string;
	description?: string;
	extra_snippets?: string[];
	age?: string;
	profile?: { name?: string };
}

interface BraveSearchResponse {
	web?: { results?: BraveWebResult[] };
	query?: { original?: string; altered?: string };
}

interface SearchResult {
	title: string;
	url: string;
	description: string;
	age?: string;
	source?: string;
	extraSnippets?: string[];
}

interface SearchDetails {
	provider: "brave";
	query: string;
	count: number;
	status: number;
	results: SearchResult[];
	truncation?: TruncationResult;
}

type HtmlExtractionMode =
	| "readability-markdown"
	| "body-markdown"
	| "plain-text-fallback"
	| "raw-html";

interface FetchDetails {
	url: string;
	finalUrl: string;
	status: number;
	contentType: string;
	title?: string;
	description?: string;
	extraction?: HtmlExtractionMode;
	bodyReadTruncated: boolean;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024)
		return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function utf8Bytes(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function truncateUtf8(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.byteLength <= maxBytes) return text;
	return buffer
		.subarray(0, maxBytes)
		.toString("utf8")
		.replace(/\uFFFD+$/g, "");
}

function truncateHead(
	text: string,
	options: { maxLines: number; maxBytes: number },
): TruncationResult {
	const allLines = text.split("\n");
	const byLines = allLines.slice(0, options.maxLines).join("\n");
	const content = truncateUtf8(byLines, options.maxBytes);
	const totalBytes = utf8Bytes(text);
	const outputBytes = utf8Bytes(content);
	return {
		content,
		truncated: allLines.length > options.maxLines || outputBytes < totalBytes,
		outputLines: content.length === 0 ? 0 : content.split("\n").length,
		totalLines: allLines.length,
		outputBytes,
		totalBytes,
	};
}

function parseEnvValue(rawValue: string): string {
	let value = rawValue.trim();
	const quote = value[0];
	if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
		value = value.slice(1, -1);
		if (quote === '"') {
			value = value
				.replace(/\\n/g, "\n")
				.replace(/\\r/g, "\r")
				.replace(/\\t/g, "\t")
				.replace(/\\"/g, '"')
				.replace(/\\\\/g, "\\");
		}
		return value;
	}

	const inlineComment = value.search(/\s+#/);
	if (inlineComment >= 0) value = value.slice(0, inlineComment).trim();
	return value;
}

function readEnvFileValue(name: string): string | undefined {
	if (!existsSync(OUTCLAW_ENV_FILE_PATH)) return undefined;

	const content = readFileSync(OUTCLAW_ENV_FILE_PATH, "utf8");
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const match = trimmed.match(
			/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/,
		);
		if (!match) continue;
		const [, key, rawValue] = match;
		if (key === name && rawValue !== undefined) return parseEnvValue(rawValue);
	}
	return undefined;
}

function getBraveApiKey(): string {
	const key =
		process.env.BRAVE_API_KEY ||
		process.env.BRAVE_SEARCH_API_KEY ||
		readEnvFileValue("BRAVE_API_KEY") ||
		readEnvFileValue("BRAVE_SEARCH_API_KEY");
	if (!key) {
		throw new Error(
			`BRAVE_API_KEY is not set. Add BRAVE_API_KEY=... to ${OUTCLAW_ENV_FILE_PATH} or export it in your shell.`,
		);
	}
	return key;
}

function clampInteger(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	const numberValue =
		typeof value === "number" && Number.isFinite(value)
			? Math.floor(value)
			: fallback;
	return Math.min(max, Math.max(min, numberValue));
}

function normalizeBraveQuery(query: string): string {
	const normalized = query.trim();
	if (!normalized) throw new Error("Brave Search query cannot be empty.");
	if (normalized.length > 400)
		throw new Error(
			"Brave Search query is too long: maximum is 400 characters.",
		);
	if (normalized.split(/\s+/).length > 50)
		throw new Error("Brave Search query is too long: maximum is 50 words.");
	return normalized;
}

function normalizeSafeSearch(
	value: string | undefined,
): "off" | "moderate" | "strict" | undefined {
	if (!value) return undefined;
	const normalized = value.toLowerCase();
	if (
		normalized === "off" ||
		normalized === "moderate" ||
		normalized === "strict"
	)
		return normalized;
	throw new Error(
		'Invalid safesearch value. Use "off", "moderate", or "strict".',
	);
}

function createTimeoutSignal(upstream: AbortSignal | undefined): {
	signal: AbortSignal;
	cleanup: () => void;
} {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("Request timed out")),
		REQUEST_TIMEOUT_MS,
	);
	const onAbort = () => controller.abort(upstream?.reason);
	upstream?.addEventListener("abort", onAbort, { once: true });

	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeout);
			upstream?.removeEventListener("abort", onAbort);
		},
	};
}

function stripTags(text: string): string {
	return text.replace(/<[^>]*>/g, "");
}

function decodeHtmlEntities(text: string): string {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
	};

	return text.replace(
		/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi,
		(_match, entity: string) => {
			const normalized = entity.toLowerCase();
			if (normalized.startsWith("#x")) {
				const codePoint = Number.parseInt(normalized.slice(2), 16);
				return Number.isFinite(codePoint)
					? String.fromCodePoint(codePoint)
					: _match;
			}
			if (normalized.startsWith("#")) {
				const codePoint = Number.parseInt(normalized.slice(1), 10);
				return Number.isFinite(codePoint)
					? String.fromCodePoint(codePoint)
					: _match;
			}
			return named[normalized] ?? _match;
		},
	);
}

function cleanInlineText(text: string | null | undefined): string {
	if (!text) return "";
	return decodeHtmlEntities(stripTags(text)).replace(/\s+/g, " ").trim();
}

function hasResultUrl(
	result: BraveWebResult,
): result is BraveWebResult & { url: string } {
	return typeof result.url === "string" && result.url.length > 0;
}

function getMetaContent(
	document: Document,
	selectors: string[],
): string | undefined {
	for (const selector of selectors) {
		const value = document.querySelector(selector)?.getAttribute("content");
		const cleaned = cleanInlineText(value ?? undefined);
		if (cleaned) return cleaned;
	}
	return undefined;
}

function extractTitleFromDocument(document: Document): string | undefined {
	const title =
		getMetaContent(document, [
			'meta[property="og:title"]',
			'meta[name="twitter:title"]',
		]) ||
		cleanInlineText(
			document.querySelector("title")?.textContent ?? undefined,
		) ||
		cleanInlineText(document.querySelector("h1")?.textContent ?? undefined);
	return title || undefined;
}

function extractDescriptionFromDocument(
	document: Document,
): string | undefined {
	return getMetaContent(document, [
		'meta[name="description"]',
		'meta[property="og:description"]',
		'meta[name="twitter:description"]',
	]);
}

function createTurndownService(): TurndownService {
	const service = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
		emDelimiter: "*",
		strongDelimiter: "**",
		linkStyle: "inlined",
	});
	service.remove(["script", "style", "noscript", "canvas", "iframe"]);
	service.addRule("remove-svg", {
		filter: (node) => node.nodeName.toLowerCase() === "svg",
		replacement: () => "",
	});
	return service;
}

function cleanMarkdown(markdown: string): string {
	return markdown
		.replace(/\r\n/g, "\n")
		.replace(/\u00a0/g, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{4,}/g, "\n\n\n")
		.trim();
}

function htmlToPlainTextFallback(html: string): string {
	const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	let text = bodyMatch?.[1] ?? html;

	text = text
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "\n")
		.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "\n")
		.replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, "\n")
		.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/p>/gi, "\n\n")
		.replace(/<\/div>/gi, "\n")
		.replace(/<\/section>/gi, "\n")
		.replace(/<\/article>/gi, "\n")
		.replace(/<\/main>/gi, "\n")
		.replace(/<\/header>/gi, "\n")
		.replace(/<\/footer>/gi, "\n")
		.replace(/<\/h[1-6]>/gi, "\n\n")
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(/<\/li>/gi, "\n")
		.replace(/<\/tr>/gi, "\n")
		.replace(/<\/(td|th)>/gi, "\t")
		.replace(/<[^>]+>/g, " ");

	return decodeHtmlEntities(text)
		.replace(/\r\n/g, "\n")
		.replace(/\t+/g, "\t")
		.replace(/[ \f\v]+/g, " ")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function parseDocument(html: string): Document {
	return parseHTML(html).document as unknown as Document;
}

function extractHtmlContent(html: string): {
	content: string;
	title?: string;
	description?: string;
	extraction: HtmlExtractionMode;
} {
	const document = parseDocument(html);
	const fallbackTitle = extractTitleFromDocument(document);
	const fallbackDescription = extractDescriptionFromDocument(document);

	try {
		const reader = new Readability(document.cloneNode(true) as Document);
		const article = reader.parse();
		if (article?.content) {
			const markdown = cleanMarkdown(
				createTurndownService().turndown(article.content),
			);
			if (markdown) {
				return {
					content: markdown,
					title: cleanInlineText(article.title) || fallbackTitle,
					description: cleanInlineText(article.excerpt) || fallbackDescription,
					extraction: "readability-markdown",
				};
			}
		}
	} catch {
		// Fall back to whole-body markdown below.
	}

	const root =
		document.querySelector("main") ??
		document.querySelector("article") ??
		document.body ??
		document.documentElement;
	const markdown = cleanMarkdown(
		createTurndownService().turndown(root.innerHTML),
	);
	if (markdown) {
		return {
			content: markdown,
			title: fallbackTitle,
			description: fallbackDescription,
			extraction: "body-markdown",
		};
	}

	return {
		content: htmlToPlainTextFallback(html),
		title: fallbackTitle,
		description: fallbackDescription,
		extraction: "plain-text-fallback",
	};
}

function extractHtmlMetadata(html: string): {
	title?: string;
	description?: string;
} {
	const document = parseDocument(html);
	return {
		title: extractTitleFromDocument(document),
		description: extractDescriptionFromDocument(document),
	};
}

function isTextLikeContentType(contentType: string): boolean {
	const lower = contentType.toLowerCase();
	return (
		lower.includes("text/") ||
		lower.includes("html") ||
		lower.includes("json") ||
		lower.includes("xml") ||
		lower.includes("javascript") ||
		lower.includes("markdown")
	);
}

async function readResponseText(
	response: Response,
	maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
	if (!response.body) {
		return { text: await response.text(), truncated: false };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let bytesRead = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		const remaining = maxBytes - bytesRead;
		if (remaining <= 0) {
			await reader.cancel();
			return { text: chunks.join("") + decoder.decode(), truncated: true };
		}

		if (value.byteLength > remaining) {
			chunks.push(decoder.decode(value.slice(0, remaining), { stream: false }));
			await reader.cancel();
			return { text: chunks.join(""), truncated: true };
		}

		bytesRead += value.byteLength;
		chunks.push(decoder.decode(value, { stream: true }));
	}

	chunks.push(decoder.decode());
	return { text: chunks.join(""), truncated: false };
}

async function saveFullOutput(
	prefix: string,
	fileName: string,
	output: string,
): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), prefix));
	const tempFile = join(tempDir, fileName);
	await writeFile(tempFile, output, "utf8");
	return tempFile;
}

function formatSearchResults(query: string, results: SearchResult[]): string {
	if (results.length === 0) {
		return `No Brave web search results found for: ${query}`;
	}

	const lines = [`Brave web search results for: ${query}`, ""];
	for (const [index, result] of results.entries()) {
		lines.push(`--- Result ${index + 1} ---`);
		lines.push(`Title: ${result.title}`);
		lines.push(`URL: ${result.url}`);
		if (result.source) lines.push(`Source: ${result.source}`);
		if (result.age) lines.push(`Age: ${result.age}`);
		if (result.description) lines.push(`Snippet: ${result.description}`);
		if (result.extraSnippets?.length) {
			lines.push("Extra snippets:");
			for (const snippet of result.extraSnippets) lines.push(`- ${snippet}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

function formatFetchedContent(options: {
	url: string;
	finalUrl: string;
	contentType: string;
	title?: string;
	description?: string;
	extraction?: HtmlExtractionMode;
	content: string;
	bodyReadTruncated: boolean;
}): string {
	const lines = [`URL: ${options.url}`];
	if (options.finalUrl !== options.url)
		lines.push(`Final URL: ${options.finalUrl}`);
	lines.push(`Content-Type: ${options.contentType || "unknown"}`);
	if (options.extraction) lines.push(`Extraction: ${options.extraction}`);
	if (options.title) lines.push(`Title: ${options.title}`);
	if (options.description) lines.push(`Description: ${options.description}`);
	if (options.bodyReadTruncated) {
		lines.push(
			`Note: Response body was cut at ${formatSize(RESPONSE_READ_LIMIT_BYTES)} before extraction.`,
		);
	}
	lines.push("", options.content);
	return lines.join("\n").trimEnd();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: `Search the web with Brave Search API. Returns up to 20 web results. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Requires BRAVE_API_KEY.`,
		promptSnippet:
			"Search the web with Brave Search API for current information, documentation, articles, and facts",
		promptGuidelines: [
			"Use web_search when you need a normal list of URLs, exact search results, current documentation, or source discovery.",
			"After web_search, use web_fetch on the most relevant result URLs before relying on details that may not be fully present in snippets.",
			"Prefer official documentation and primary sources in web_search results when answering coding questions.",
		],
		parameters: webSearchParams,

		async execute(_toolCallId, params, signal) {
			const apiKey = getBraveApiKey();
			const query = normalizeBraveQuery(params.query);
			const count = clampInteger(params.count, 5, 1, 20);
			const safesearch = normalizeSafeSearch(params.safesearch);
			const requestUrl = new URL(BRAVE_SEARCH_URL);
			requestUrl.searchParams.set("q", query);
			requestUrl.searchParams.set("count", String(count));
			requestUrl.searchParams.set(
				"country",
				(params.country || "US").toUpperCase(),
			);
			requestUrl.searchParams.set("search_lang", params.search_lang || "en");
			requestUrl.searchParams.set("result_filter", "web");
			requestUrl.searchParams.set("text_decorations", "false");
			requestUrl.searchParams.set("extra_snippets", "true");
			requestUrl.searchParams.set("spellcheck", "true");
			if (safesearch) requestUrl.searchParams.set("safesearch", safesearch);
			if (params.freshness)
				requestUrl.searchParams.set("freshness", params.freshness);

			const timeout = createTimeoutSignal(signal);
			let response: Response;
			try {
				response = await fetch(requestUrl, {
					signal: timeout.signal,
					headers: {
						Accept: "application/json",
						"Accept-Encoding": "gzip",
						"X-Subscription-Token": apiKey,
					},
				});
			} finally {
				timeout.cleanup();
			}

			if (!response.ok) {
				const errorText = await response.text().catch(() => "");
				throw new Error(
					`Brave Search failed (${response.status} ${response.statusText}): ${errorText.slice(0, 1000)}`,
				);
			}

			const data = (await response.json()) as BraveSearchResponse;
			const results: SearchResult[] = (data.web?.results ?? [])
				.slice(0, count)
				.filter(hasResultUrl)
				.map((result) => ({
					title: cleanInlineText(result.title) || result.url || "Untitled",
					url: result.url,
					description: cleanInlineText(result.description),
					age: result.age,
					source: result.profile?.name,
					extraSnippets: result.extra_snippets
						?.map(cleanInlineText)
						.filter(Boolean),
				}));

			let output = formatSearchResults(query, results);
			const truncation = truncateHead(output, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});
			output = truncation.content;
			const details: SearchDetails = {
				provider: "brave",
				query,
				count,
				status: response.status,
				results,
			};

			if (truncation.truncated) {
				details.truncation = truncation;
				output += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
					truncation.outputBytes,
				)} of ${formatSize(truncation.totalBytes)}).]`;
			}

			return {
				content: [{ type: "text", text: output }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: `Fetch a URL and return readable Markdown/text. HTML is extracted with Mozilla Readability and converted to Markdown with Turndown by default. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; full cleaned output is saved to a temp file when truncated.`,
		promptSnippet:
			"Fetch and extract readable Markdown/text from a specific web URL",
		promptGuidelines: [
			"Use web_fetch to verify details from specific URLs before answering with facts from the web.",
			"Use web_fetch after web_search for result URLs that look relevant, especially official documentation or primary sources.",
			"Do not use web_fetch for non-http URLs or large binary files.",
		],
		parameters: webFetchParams,

		async execute(_toolCallId, params, signal) {
			let parsedUrl: URL;
			try {
				parsedUrl = new URL(params.url);
			} catch {
				throw new Error(`Invalid URL: ${params.url}`);
			}
			if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
				throw new Error(
					`Unsupported URL protocol: ${parsedUrl.protocol}. Only http:// and https:// are supported.`,
				);
			}

			const timeout = createTimeoutSignal(signal);
			let response: Response;
			try {
				response = await fetch(parsedUrl, {
					signal: timeout.signal,
					headers: {
						Accept:
							"text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.8,*/*;q=0.5",
						"User-Agent": "pi-coding-agent-web-tools/1.0 (+https://pi.dev)",
					},
					redirect: "follow",
				});
			} finally {
				timeout.cleanup();
			}

			const contentType = response.headers.get("content-type") ?? "";
			if (!isTextLikeContentType(contentType)) {
				throw new Error(
					`Refusing to fetch non-text content-type: ${contentType || "unknown"}`,
				);
			}

			const { text: body, truncated: bodyReadTruncated } =
				await readResponseText(response, RESPONSE_READ_LIMIT_BYTES);
			if (!response.ok) {
				throw new Error(
					`Fetch failed (${response.status} ${response.statusText}): ${body.slice(0, 1000)}`,
				);
			}

			const isHtml =
				contentType.toLowerCase().includes("html") || /<html[\s>]/i.test(body);
			let title: string | undefined;
			let description: string | undefined;
			let extraction: HtmlExtractionMode | undefined;
			let extracted = body;

			if (isHtml && !params.raw) {
				const htmlExtraction = extractHtmlContent(body);
				title = htmlExtraction.title;
				description = htmlExtraction.description;
				extraction = htmlExtraction.extraction;
				extracted = htmlExtraction.content;
			} else if (isHtml && params.raw) {
				const metadata = extractHtmlMetadata(body);
				title = metadata.title;
				description = metadata.description;
				extraction = "raw-html";
			}

			if (contentType.toLowerCase().includes("json") && !params.raw) {
				try {
					extracted = JSON.stringify(JSON.parse(body), null, 2);
				} catch {
					// Keep original body if it is not valid JSON despite the content type.
				}
			}

			const fullOutput = formatFetchedContent({
				url: parsedUrl.toString(),
				finalUrl: response.url,
				contentType,
				title,
				description,
				extraction,
				content: extracted,
				bodyReadTruncated,
			});

			const truncation = truncateHead(fullOutput, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});
			let output = truncation.content;
			const details: FetchDetails = {
				url: parsedUrl.toString(),
				finalUrl: response.url,
				status: response.status,
				contentType,
				title,
				description,
				extraction,
				bodyReadTruncated,
			};

			if (truncation.truncated) {
				const tempFile = await saveFullOutput(
					"pi-web-fetch-",
					"content.txt",
					fullOutput,
				);
				details.truncation = truncation;
				details.fullOutputPath = tempFile;
				output += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
				output += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
				output += ` Full cleaned output saved to: ${tempFile}]`;
			}

			return {
				content: [{ type: "text", text: output }],
				details,
			};
		},
	});
}
