import { describe, expect, test } from "bun:test";
import { RenderErrorBoundary } from "../../../src/frontend/browser/components/render-error-boundary.tsx";

describe("RenderErrorBoundary", () => {
	test("renders children when no error has been recorded", () => {
		const boundary = new RenderErrorBoundary({
			children: "child content",
			fallback: "error fallback",
		});

		expect(boundary.render()).toBe("child content");
	});

	test("switches to fallback after an error", () => {
		const boundary = new RenderErrorBoundary({
			children: "child content",
			fallback: "error fallback",
		});

		expect(
			RenderErrorBoundary.getDerivedStateFromError(new Error("boom")),
		).toEqual({ hasError: true });

		boundary.state = { hasError: true };
		expect(boundary.render()).toBe("error fallback");
	});
});
