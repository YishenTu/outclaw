import { describe, expect, test } from "bun:test";
import {
	planProgressLabel,
	readToolDetails,
	readUpdatePlanArguments,
} from "../../../src/frontend/browser/coding/coding-event-data.ts";

describe("coding event data", () => {
	test("normalizes tool details", () => {
		expect(
			readToolDetails([{ label: "query", value: "outclaw" }, null]),
		).toEqual([{ label: "query", value: "outclaw" }]);
	});

	test("parses update plan arguments", () => {
		const result = readUpdatePlanArguments({
			type: "tool",
			details: [
				{
					label: "arguments",
					value: JSON.stringify({
						explanation: "Ship it",
						plan: [{ step: "Test", status: "completed" }],
					}),
				},
			],
		});
		expect(result).toEqual({
			explanation: "Ship it",
			steps: [{ step: "Test", status: "completed" }],
		});
		expect(planProgressLabel(result?.steps ?? [])).toBe("1/1 done");
	});
});
