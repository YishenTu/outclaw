import { describe, expect, test } from "bun:test";
import {
	buildClientIdCookieHeader,
	generateClientId,
	parseClientIdCookie,
} from "../../../src/runtime/supervisor/cookies.ts";

function requestWithCookie(cookie?: string): Request {
	return new Request("http://localhost", {
		headers: cookie === undefined ? undefined : { cookie },
	});
}

describe("parseClientIdCookie", () => {
	test("returns undefined when no Cookie header is present", () => {
		expect(parseClientIdCookie(requestWithCookie())).toBeUndefined();
	});

	test("returns undefined when the header has no oc_client_id entry", () => {
		expect(
			parseClientIdCookie(requestWithCookie("theme=dark; session=abc")),
		).toBeUndefined();
	});

	test("extracts the value when oc_client_id is the only cookie", () => {
		expect(
			parseClientIdCookie(requestWithCookie("oc_client_id=client-123")),
		).toBe("client-123");
	});

	test("extracts the value when oc_client_id is one of several cookies", () => {
		const cases = [
			"oc_client_id=client-123; theme=dark; session=abc",
			"theme=dark; oc_client_id=client-123; session=abc",
			"theme=dark; session=abc; oc_client_id=client-123",
		];

		for (const cookie of cases) {
			expect(parseClientIdCookie(requestWithCookie(cookie))).toBe("client-123");
		}
	});

	test("tolerates whitespace around cookie pairs", () => {
		expect(
			parseClientIdCookie(
				requestWithCookie("  theme=dark  ;  oc_client_id=client-123  "),
			),
		).toBe("client-123");
	});

	test("returns undefined for an empty oc_client_id value", () => {
		expect(
			parseClientIdCookie(requestWithCookie("oc_client_id=")),
		).toBeUndefined();
	});

	test("ignores cookies with the same name prefix", () => {
		expect(
			parseClientIdCookie(requestWithCookie("oc_client_id_extra=client-123")),
		).toBeUndefined();
	});
});

describe("generateClientId", () => {
	test("returns unique UUID-shaped strings", () => {
		const ids = Array.from({ length: 20 }, () => generateClientId());

		for (const id of ids) {
			expect(id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
		}
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("buildClientIdCookieHeader", () => {
	test("emits the browser client id cookie header", () => {
		const header = buildClientIdCookieHeader("client-123");

		expect(header).toContain("oc_client_id=client-123");
		expect(header).toContain("Path=/");
		expect(header).toContain("HttpOnly");
		expect(header).toContain("SameSite=Lax");
		expect(header).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
	});
});
