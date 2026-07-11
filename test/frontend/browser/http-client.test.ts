import { describe, expect, mock, test } from "bun:test";
import {
	HttpRequestError,
	requestJson,
} from "../../../src/frontend/browser/lib/http-client.ts";

describe("requestJson", () => {
	test("passes abort signals to fetch", async () => {
		const controller = new AbortController();
		const fetcher = mock(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				expect(init?.signal).toBe(controller.signal);
				return Response.json({ ok: true });
			},
		);

		await expect(
			requestJson<{ ok: boolean }>("/api/example", {
				fetcher: fetcher as unknown as typeof fetch,
				signal: controller.signal,
			}),
		).resolves.toEqual({ ok: true });
	});

	test("reports structured request errors", async () => {
		const fetcher = mock(async () =>
			Response.json({ error: "Not allowed" }, { status: 403 }),
		);

		try {
			await requestJson("/api/example", {
				fetcher: fetcher as unknown as typeof fetch,
			});
			throw new Error("Expected request to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(HttpRequestError);
			expect(error).toMatchObject({ status: 403, message: "Not allowed" });
		}
	});

	test("rejects invalid response payloads", async () => {
		const fetcher = mock(async () => Response.json({ ok: "yes" }));

		await expect(
			requestJson("/api/example", {
				fetcher: fetcher as unknown as typeof fetch,
				validate: (value): value is { ok: boolean } =>
					typeof value === "object" &&
					value !== null &&
					typeof (value as { ok?: unknown }).ok === "boolean",
			}),
		).rejects.toThrow("Invalid response payload");
	});
});
