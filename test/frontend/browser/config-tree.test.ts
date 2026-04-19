import { describe, expect, test } from "bun:test";
import { buildConfigEntryTree } from "../../../src/frontend/browser/components/agent-sidebar/config-tree.ts";

describe("config tree", () => {
	test("groups flat config entries into nested display sections", () => {
		expect(
			buildConfigEntryTree([
				{
					displayItem: "host",
					item: "host",
					value: "127.0.0.1",
					valueKind: "string",
				},
				{
					displayItem: "agents.railly.telegram.allowedUsers",
					item: "agents.agent-railly.telegram.allowedUsers",
					typeLabel: "number[]",
					value: "[\n\t101,\n\t202\n]",
					valueKind: "array",
				},
			]),
		).toEqual([
			{
				children: [],
				entry: {
					displayItem: "host",
					item: "host",
					value: "127.0.0.1",
					valueKind: "string",
				},
				key: "host",
				label: "host",
			},
			{
				children: [
					{
						children: [
							{
								children: [
									{
										children: [],
										entry: {
											displayItem: "agents.railly.telegram.allowedUsers",
											item: "agents.agent-railly.telegram.allowedUsers",
											typeLabel: "number[]",
											value: "[\n\t101,\n\t202\n]",
											valueKind: "array",
										},
										key: "allowedUsers",
										label: "allowedUsers",
									},
								],
								key: "telegram",
								label: "telegram",
							},
						],
						key: "railly",
						label: "railly",
					},
				],
				key: "agents",
				label: "agents",
			},
		]);
	});
});
