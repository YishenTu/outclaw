import { describe, expect, test } from "bun:test";
import type {
	BrowserConfigSchemaNode,
	BrowserConfigSchemaStringFormat,
} from "../../../src/common/protocol.ts";
import {
	applyConfigEntryEdits,
	parseConfigEntries,
} from "../../../src/frontend/browser/components/agent-sidebar/config-editor.ts";
import { ConfigModalContent } from "../../../src/frontend/browser/components/agent-sidebar/config-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

const TEST_CONFIG_SCHEMA: BrowserConfigSchemaNode = {
	kind: "object",
	properties: {
		autoCompact: {
			kind: "leaf",
			editorKinds: ["boolean"],
			typeLabel: "boolean",
		},
		heartbeat: {
			kind: "object",
			properties: {
				deferMinutes: {
					kind: "leaf",
					editorKinds: ["number"],
					typeLabel: "number",
				},
				intervalMinutes: {
					kind: "leaf",
					editorKinds: ["number"],
					typeLabel: "number",
				},
			},
		},
		host: {
			kind: "leaf",
			editorKinds: ["string"],
			typeLabel: "string",
		},
		port: {
			kind: "leaf",
			editorKinds: ["number"],
			typeLabel: "number",
		},
		agents: {
			kind: "object",
			additionalProperties: {
				kind: "object",
				properties: {
					telegram: {
						kind: "object",
						properties: {
							allowedUsers: {
								kind: "leaf",
								editorKinds: ["array", "string"],
								stringFormat: "env_ref",
								typeLabel: "number[] | string",
							},
							botToken: {
								kind: "leaf",
								editorKinds: ["string"],
								typeLabel: "string",
							},
							defaultCronUserId: {
								kind: "leaf",
								editorKinds: ["number", "string"],
								stringFormat: "env_ref",
								typeLabel: "number | string",
							},
						},
					},
				},
			},
		},
	},
};

describe("config panel", () => {
	test("uses code schema to keep typed leaves intact", () => {
		expect(
			parseConfigEntries(
				{
					autoCompact: true,
					heartbeat: {
						intervalMinutes: 30,
						deferMinutes: 0,
					},
					agents: {
						"agent-railly": {
							telegram: {
								allowedUsers: [101, 202],
							},
						},
					},
				},
				{
					agentNamesById: {
						"agent-railly": "railly",
					},
					schema: TEST_CONFIG_SCHEMA,
				},
			),
		).toEqual([
			{
				allowedValueKinds: ["boolean"],
				displayItem: "autoCompact",
				item: "autoCompact",
				typeLabel: "boolean",
				value: "true",
				valueKind: "boolean",
			},
			{
				allowedValueKinds: ["number"],
				displayItem: "heartbeat.intervalMinutes",
				item: "heartbeat.intervalMinutes",
				typeLabel: "number",
				value: "30",
				valueKind: "number",
			},
			{
				allowedValueKinds: ["number"],
				displayItem: "heartbeat.deferMinutes",
				item: "heartbeat.deferMinutes",
				typeLabel: "number",
				value: "0",
				valueKind: "number",
			},
			{
				allowedValueKinds: ["array", "string"],
				displayItem: "agents.railly.telegram.allowedUsers",
				item: "agents.agent-railly.telegram.allowedUsers",
				stringFormat: "env_ref",
				typeLabel: "number[] | string",
				value: "[\n\t101,\n\t202\n]",
				valueKind: "array",
			},
		]);
	});

	test("uses code schema for empty arrays too", () => {
		expect(
			parseConfigEntries(
				{
					agents: {
						"agent-railly": {
							telegram: {
								allowedUsers: [],
							},
						},
					},
				},
				{
					schema: TEST_CONFIG_SCHEMA,
				},
			),
		).toEqual([
			{
				allowedValueKinds: ["array", "string"],
				displayItem: "agents.agent-railly.telegram.allowedUsers",
				item: "agents.agent-railly.telegram.allowedUsers",
				stringFormat: "env_ref",
				typeLabel: "number[] | string",
				value: "[]",
				valueKind: "array",
			},
		]);
	});

	test("accepts env-string edits for union-typed stored config fields", () => {
		expect(
			applyConfigEntryEdits(
				{
					agents: {
						"agent-railly": {
							telegram: {
								allowedUsers: [101, 202],
								defaultCronUserId: 101,
							},
						},
					},
				},
				[
					{
						allowedValueKinds: ["array", "string"],
						item: "agents.agent-railly.telegram.allowedUsers",
						stringFormat: "env_ref" satisfies BrowserConfigSchemaStringFormat,
						typeLabel: "number[] | string",
						value: "$RAILLY_TELEGRAM_USERS",
						valueKind: "array",
					},
					{
						allowedValueKinds: ["number", "string"],
						item: "agents.agent-railly.telegram.defaultCronUserId",
						stringFormat: "env_ref" satisfies BrowserConfigSchemaStringFormat,
						typeLabel: "number | string",
						value: "$RAILLY_DEFAULT_CRON_USER",
						valueKind: "number",
					},
				],
			),
		).toEqual({
			agents: {
				"agent-railly": {
					telegram: {
						allowedUsers: "$RAILLY_TELEGRAM_USERS",
						defaultCronUserId: "$RAILLY_DEFAULT_CRON_USER",
					},
				},
			},
		});
	});

	test("rejects arbitrary strings for env-ref-only union fields", () => {
		expect(() =>
			applyConfigEntryEdits(
				{
					agents: {
						"agent-railly": {
							telegram: {
								allowedUsers: [101, 202],
								defaultCronUserId: 101,
							},
						},
					},
				},
				[
					{
						allowedValueKinds: ["array", "string"],
						item: "agents.agent-railly.telegram.allowedUsers",
						stringFormat: "env_ref" satisfies BrowserConfigSchemaStringFormat,
						typeLabel: "number[] | string",
						value: "oops",
						valueKind: "array",
					},
				],
			),
		).toThrow(
			"Expected environment variable reference like $NAME for agents.agent-railly.telegram.allowedUsers",
		);
	});

	test("applies edited values back into the config document", () => {
		expect(
			applyConfigEntryEdits(
				{
					host: "127.0.0.1",
					port: 4000,
					autoCompact: true,
					heartbeat: {
						intervalMinutes: 30,
					},
				},
				[
					{
						item: "host",
						typeLabel: "string",
						value: "0.0.0.0",
						valueKind: "string",
					},
					{
						item: "port",
						typeLabel: "number",
						value: "4100",
						valueKind: "number",
					},
					{
						item: "autoCompact",
						typeLabel: "boolean",
						value: "false",
						valueKind: "boolean",
					},
					{
						item: "heartbeat.intervalMinutes",
						typeLabel: "number",
						value: "45",
						valueKind: "number",
					},
				],
			),
		).toEqual({
			host: "0.0.0.0",
			port: 4100,
			autoCompact: false,
			heartbeat: {
				intervalMinutes: 45,
			},
		});
	});

	test("renders parsed config entries", () => {
		const html = renderToStaticMarkup(
			<ConfigModalContent
				entries={[
					{
						displayItem: "host",
						item: "host",
						typeLabel: "string",
						value: "127.0.0.1",
						valueKind: "string",
					},
					{
						displayItem: "agents.railly.telegram.botToken",
						item: "agents.agent-railly.telegram.botToken",
						typeLabel: "string",
						value: "secret",
						valueKind: "string",
					},
				]}
				error={null}
				errorMode="load"
				isLoading={false}
				isSaving={false}
				onClose={() => {}}
				onEntryChange={() => {}}
				onSave={() => {}}
			/>,
		);

		expect(html).toContain("config.json");
		expect(html).toContain("host");
		expect(html).toContain('value="127.0.0.1"');
		expect(html).toContain("agents");
		expect(html).toContain("railly");
		expect(html).toContain("telegram");
		expect(html).toContain("botToken");
		expect(html).not.toContain("agents.railly.telegram.botToken");
		expect(html).not.toContain("agents.agent-railly.telegram.botToken");
		expect(html).toContain('value="secret"');
		expect(html).toContain('aria-label="Config modal"');
		expect(html).toContain("Save changes");
		expect(html).toContain("scrollbar-none flex-1 overflow-y-auto px-5 py-4");
	});

	test("renders a load error", () => {
		const html = renderToStaticMarkup(
			<ConfigModalContent
				entries={[]}
				error="Invalid JSON"
				errorMode="load"
				isLoading={false}
				isSaving={false}
				onClose={() => {}}
				onEntryChange={() => {}}
				onSave={() => {}}
			/>,
		);

		expect(html).toContain("Failed to load config");
		expect(html).toContain("Invalid JSON");
	});

	test("renders save errors without hiding editable fields", () => {
		const html = renderToStaticMarkup(
			<ConfigModalContent
				entries={[
					{
						displayItem: "agents.railly.telegram.allowedUsers",
						item: "agents.agent-railly.telegram.allowedUsers",
						typeLabel: "number[] | string",
						value: "oops",
						valueKind: "string",
					},
				]}
				error="Expected environment variable reference like $NAME"
				errorMode="save"
				isLoading={false}
				isSaving={false}
				onClose={() => {}}
				onEntryChange={() => {}}
				onSave={() => {}}
			/>,
		);

		expect(html).toContain("Failed to save config");
		expect(html).toContain('value="oops"');
		expect(html).toContain("Save changes");
	});
});
