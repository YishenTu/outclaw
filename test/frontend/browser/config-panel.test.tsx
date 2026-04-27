import { describe, expect, test } from "bun:test";
import type {
	BrowserConfigSchemaNode,
	BrowserConfigSchemaStringFormat,
} from "../../../src/common/protocol.ts";
import {
	applyConfigEntryEdits,
	parseConfigDocument,
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
	test("parses only object config documents", () => {
		expect(parseConfigDocument('{"host":"127.0.0.1"}')).toEqual({
			host: "127.0.0.1",
		});
		expect(() => parseConfigDocument("[]")).toThrow(
			"Config file must contain a JSON object",
		);
		expect(() => parseConfigDocument("null")).toThrow(
			"Config file must contain a JSON object",
		);
	});

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

	test("parses fallback entries for arrays, empty objects, nulls, and primitives", () => {
		expect(
			parseConfigEntries({
				emptyArray: [],
				emptyObject: {},
				matrix: [[1], [2]],
				nullable: null,
				title: "outclaw",
			}),
		).toEqual([
			{
				displayItem: "emptyArray",
				item: "emptyArray",
				value: "[]",
				valueKind: "array",
			},
			{
				displayItem: "emptyObject",
				item: "emptyObject",
				value: "{}",
				valueKind: "object",
			},
			{
				displayItem: "matrix[0][0]",
				item: "matrix[0][0]",
				typeLabel: undefined,
				value: "1",
				valueKind: "number",
			},
			{
				displayItem: "matrix[1][0]",
				item: "matrix[1][0]",
				typeLabel: undefined,
				value: "2",
				valueKind: "number",
			},
			{
				displayItem: "nullable",
				item: "nullable",
				typeLabel: undefined,
				value: "null",
				valueKind: "null",
			},
			{
				displayItem: "title",
				item: "title",
				typeLabel: undefined,
				value: "outclaw",
				valueKind: "string",
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

	test("applies edited array, object, null, and union literal values", () => {
		expect(
			applyConfigEntryEdits(
				{
					features: {
						enabled: false,
						limit: 1,
						metadata: { mode: "old" },
						mode: "auto",
						nullable: "value",
						users: [1],
					},
				},
				[
					{
						allowedValueKinds: ["boolean", "string"],
						item: "features.enabled",
						value: "true",
						valueKind: "boolean",
					},
					{
						allowedValueKinds: ["number", "string"],
						item: "features.limit",
						value: "2.5e1",
						valueKind: "number",
					},
					{
						item: "features.metadata",
						value: '{"mode":"new"}',
						valueKind: "object",
					},
					{
						allowedValueKinds: ["null", "string"],
						item: "features.nullable",
						value: "null",
						valueKind: "string",
					},
					{
						item: "features.users",
						value: "[2,3]",
						valueKind: "array",
					},
				],
			),
		).toEqual({
			features: {
				enabled: true,
				limit: 25,
				metadata: { mode: "new" },
				mode: "auto",
				nullable: null,
				users: [2, 3],
			},
		});
	});

	test("rejects invalid config edit paths and typed values", () => {
		expect(() =>
			applyConfigEntryEdits({ features: { enabled: true } }, [
				{
					item: "features.missing.enabled",
					value: "false",
					valueKind: "boolean",
				},
			]),
		).toThrow("Missing config path: features.missing.enabled");
		expect(() =>
			applyConfigEntryEdits({ users: [1] }, [
				{
					item: "users[abc]",
					value: "2",
					valueKind: "number",
				},
			]),
		).toThrow("Invalid config path: users[abc]");
		expect(() =>
			applyConfigEntryEdits({ users: [1] }, [
				{
					item: "users[0]",
					value: "",
					valueKind: "number",
				},
			]),
		).toThrow("Invalid number for users[0]");
		expect(() =>
			applyConfigEntryEdits({ enabled: true }, [
				{
					item: "enabled",
					value: "sometimes",
					valueKind: "boolean",
				},
			]),
		).toThrow("Invalid boolean for enabled");
		expect(() =>
			applyConfigEntryEdits({ nullable: null }, [
				{
					item: "nullable",
					value: "nil",
					valueKind: "null",
				},
			]),
		).toThrow("Invalid null literal for nullable");
		expect(() =>
			applyConfigEntryEdits({ users: [1] }, [
				{
					item: "users",
					value: '{"not":"array"}',
					valueKind: "array",
				},
			]),
		).toThrow("Config value must remain an array for users");
		expect(() =>
			applyConfigEntryEdits({ settings: { mode: "auto" } }, [
				{
					item: "settings",
					value: "[1]",
					valueKind: "object",
				},
			]),
		).toThrow("Config value must remain an object for settings");
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
		expect(html).toContain(">string<");
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
		expect(html).toContain('class="flex min-w-0 flex-col items-start gap-0.5"');
	});

	test("renders shorter config editors while keeping type labels visible", () => {
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
						displayItem: "agents.railly.telegram.allowedUsers",
						item: "agents.agent-railly.telegram.allowedUsers",
						typeLabel: "number[] | string",
						value: "[1,2]",
						valueKind: "array",
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

		expect(html).toContain(">string<");
		expect(html).toContain(">number[] | string<");
		expect(html).toContain(
			"grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]",
		);
		expect(html).toContain("scrollbar-none resize-none w-full max-w-[22rem]");
		expect(html).toContain('rows="1"');
		expect(html).toContain('class="w-full max-w-[22rem] rounded-lg');
	});

	test("renders union string values as single-line inputs", () => {
		const html = renderToStaticMarkup(
			<ConfigModalContent
				entries={[
					{
						allowedValueKinds: ["array", "string"],
						displayItem: "agents.railly.telegram.allowedUsers",
						item: "agents.agent-railly.telegram.allowedUsers",
						typeLabel: "number[] | string",
						value: "$RAILLY_TELEGRAM_USERS",
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

		expect(html).toContain('<input type="text"');
		expect(html).toContain('value="$RAILLY_TELEGRAM_USERS"');
		expect(html).toContain(">string<");
		expect(html).not.toContain(">number[] | string<");
		expect(html).not.toContain("<textarea");
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
