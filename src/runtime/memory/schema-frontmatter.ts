import { parse as parseYaml } from "yaml";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type SchemaFrontmatterParseResult =
	| { status: "ok"; frontmatter: Record<string, unknown> }
	| { status: "missing" }
	| { status: "unparseable" };

export function parseSchemaFrontmatter(
	content: string,
): SchemaFrontmatterParseResult {
	const extracted = extractFrontmatter(content);
	if (extracted.status !== "ok") {
		return extracted;
	}

	let parsed: unknown;
	try {
		parsed = parseYaml(extracted.content) ?? {};
	} catch {
		return { status: "unparseable" };
	}

	if (!isRecord(parsed)) {
		return { status: "unparseable" };
	}

	return {
		status: "ok",
		frontmatter: parsed,
	};
}

export function readSchemaDateField(
	frontmatter: Record<string, unknown>,
	field: "last_observation_at" | "last_synthesized",
): { value: string; error?: undefined } | { value: null; error: string } {
	const value = frontmatter[field];
	if (value === undefined) {
		return { value: null, error: `missing ${field}` };
	}

	const date = normalizeSchemaDate(value);
	if (!date) {
		return { value: null, error: `malformed ${field}` };
	}

	return { value: date };
}

export function parseSchemaDescription(
	frontmatter: Record<string, unknown>,
): string | undefined {
	const description =
		typeof frontmatter.description === "string"
			? frontmatter.description.trim()
			: "";
	return description.length > 0 ? description : undefined;
}

function extractFrontmatter(
	content: string,
):
	| { status: "ok"; content: string }
	| { status: "missing" }
	| { status: "unparseable" } {
	const lines = content.split(/\r?\n/);
	if (lines[0] !== "---") {
		return { status: "missing" };
	}

	const endIndex = lines.findIndex(
		(line, index) => index > 0 && line === "---",
	);
	if (endIndex < 0) {
		return { status: "unparseable" };
	}

	return {
		status: "ok",
		content: lines.slice(1, endIndex).join("\n"),
	};
}

function normalizeSchemaDate(value: unknown): string | undefined {
	if (typeof value === "string") {
		return DATE_PATTERN.test(value) ? value : undefined;
	}

	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		const year = value.getUTCFullYear();
		const month = String(value.getUTCMonth() + 1).padStart(2, "0");
		const day = String(value.getUTCDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
