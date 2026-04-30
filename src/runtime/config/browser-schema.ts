import { EFFORT_LEVELS } from "../../common/commands.ts";
import type { BrowserConfigSchemaNode } from "../../common/protocol.ts";

const booleanLeaf = {
	kind: "leaf",
	editorKinds: ["boolean"],
	typeLabel: "boolean",
} as const;

const numberLeaf = {
	kind: "leaf",
	editorKinds: ["number"],
	typeLabel: "number",
} as const;

const stringLeaf = {
	kind: "leaf",
	editorKinds: ["string"],
	typeLabel: "string",
} as const;

export function createBrowserConfigSchema(): BrowserConfigSchemaNode {
	return {
		kind: "object",
		properties: {
			autoCompact: booleanLeaf,
			heartbeat: {
				kind: "object",
				properties: {
					deferMinutes: numberLeaf,
					intervalMinutes: numberLeaf,
				},
			},
			host: stringLeaf,
			port: numberLeaf,
			thinkingEffort: {
				kind: "leaf",
				editorKinds: ["string"],
				typeLabel: EFFORT_LEVELS.join(" | "),
			},
			agents: {
				kind: "object",
				additionalProperties: {
					kind: "object",
					properties: {
						rollover: {
							kind: "object",
							properties: {
								idleMinutes: numberLeaf,
							},
						},
						terminal: {
							kind: "object",
							properties: {
								runCommand: stringLeaf,
							},
						},
						telegram: {
							kind: "object",
							properties: {
								allowedUsers: {
									kind: "leaf",
									editorKinds: ["array", "string"],
									stringFormat: "env_ref",
									typeLabel: "number[] | string",
								},
								botToken: stringLeaf,
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
}
