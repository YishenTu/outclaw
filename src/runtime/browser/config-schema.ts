import type { BrowserConfigSchemaNode } from "../../common/protocol.ts";

export const BROWSER_CONFIG_SCHEMA: BrowserConfigSchemaNode = {
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
					rollover: {
						kind: "object",
						properties: {
							idleMinutes: {
								kind: "leaf",
								editorKinds: ["number"],
								typeLabel: "number",
							},
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
