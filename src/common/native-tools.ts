export type NativeToolSafetyClass =
	| "read-only"
	| "state-changing"
	| "long-running";

export interface NativeToolModeContract {
	readonly name: string;
	readonly safetyClasses: readonly NativeToolSafetyClass[];
}

export interface NativeToolContract {
	readonly name: string;
	readonly description: string;
	readonly safetyClasses: readonly NativeToolSafetyClass[];
	readonly modes: readonly NativeToolModeContract[];
}

export const OUTCLAW_NATIVE_TOOL_CATALOG = [
	{
		name: "outclaw_peer_message",
		description:
			"Use when: discovering or communicating with another Outclaw agent. Modes: list returns known agents; ask sends a prompt and waits for a peer response; send enqueues a prompt without waiting. Safety: list is read-only, ask is state-changing and long-running, and send is state-changing; host guardrails reject unsafe waits and read-only contexts before effects. Do not use when: recalling old sessions, starting code work, or writing durable memory.",
		safetyClasses: [],
		modes: [
			{ name: "list", safetyClasses: ["read-only"] },
			{ name: "ask", safetyClasses: ["state-changing", "long-running"] },
			{ name: "send", safetyClasses: ["state-changing"] },
		],
	},
	{
		name: "outclaw_memory_note",
		description:
			"Use when: writing a durable memory note for the current agent. Mode: none; provide text directly without a mode parameter. Safety: state-changing; the host rejects read-only or ephemeral contexts before writing. Do not use when: reading memory/schema state, recalling chat history, or sending a note to another agent.",
		safetyClasses: ["state-changing"],
		modes: [],
	},
	{
		name: "outclaw_recall",
		description:
			"Use when: finding or reading prior chat or cron session context. Modes: sessions lists recent sessions or searches transcript text; transcript reads one provider-qualified session transcript. Safety: read-only for sessions and transcript; the host must still apply cross-agent recall policy. Do not use when: managing coding sessions, inspecting schema freshness, or communicating with peers.",
		safetyClasses: [],
		modes: [
			{ name: "sessions", safetyClasses: ["read-only"] },
			{ name: "transcript", safetyClasses: ["read-only"] },
		],
	},
	{
		name: "outclaw_schema",
		description:
			"Use when: inspecting memory schema freshness for the current or requested agent. Modes: all lists every schema; stale lists schemas that need synthesis or maintenance. Safety: read-only for all and stale. Do not use when: adding new memory or reading chat transcripts.",
		safetyClasses: [],
		modes: [
			{ name: "all", safetyClasses: ["read-only"] },
			{ name: "stale", safetyClasses: ["read-only"] },
		],
	},
	{
		name: "outclaw_cron",
		description:
			"Use when: inspecting failed cron runs or manually triggering a known cron job. Modes: failed_status lists failures with optional job, since, and limit filters; run triggers an existing job by name. Safety: failed_status is read-only; run is state-changing and long-running, and the host rejects read-only contexts and cron recursion before effects. Do not use when: sending ordinary chat prompts, starting code work, or recalling sessions.",
		safetyClasses: [],
		modes: [
			{ name: "failed_status", safetyClasses: ["read-only"] },
			{
				name: "run",
				safetyClasses: ["state-changing", "long-running"],
			},
		],
	},
	{
		name: "outclaw_coding",
		description:
			"Use when: managing Codex-backed code-mode tasks from chat. Modes: list returns repositories and recent sessions; start begins a task; resume sends a follow-up; status inspects state; transcript reads normalized events; cancel stops active work. Safety: list, status, and transcript are read-only; start and resume are state-changing and long-running; cancel is state-changing; the host rejects disabled modes before effects. Do not use when: recalling chat sessions, peer messaging, or capturing memory.",
		safetyClasses: [],
		modes: [
			{ name: "list", safetyClasses: ["read-only"] },
			{ name: "start", safetyClasses: ["state-changing", "long-running"] },
			{ name: "resume", safetyClasses: ["state-changing", "long-running"] },
			{ name: "status", safetyClasses: ["read-only"] },
			{ name: "transcript", safetyClasses: ["read-only"] },
			{ name: "cancel", safetyClasses: ["state-changing"] },
		],
	},
] as const satisfies readonly NativeToolContract[];

export type OutclawNativeToolName =
	(typeof OUTCLAW_NATIVE_TOOL_CATALOG)[number]["name"];

export type NativeToolErrorCode =
	| "validation_error"
	| "not_found"
	| "ambiguous_ref"
	| "context_disabled"
	| "policy_denied"
	| "read_only_violation"
	| "provider_failure"
	| "timeout";

export interface NativeToolError {
	readonly code: NativeToolErrorCode;
	readonly message: string;
	readonly retryable?: boolean;
}

export type NativeToolResult<T> =
	| { readonly ok: true; readonly data: T; readonly message?: string }
	| { readonly ok: false; readonly error: NativeToolError };

export type OutclawPeerMessageParams =
	| {
			readonly mode: "list";
	  }
	| {
			readonly mode: "ask" | "send";
			readonly targetAgent: string;
			readonly message: string;
			readonly timeoutSeconds?: number;
	  };

export interface OutclawMemoryNoteParams {
	readonly text: string;
	readonly salience?:
		| "correction"
		| "confirmation"
		| "decision"
		| "surprise"
		| "routine";
	readonly title?: string;
	readonly tags?: readonly string[];
}

export type OutclawRecallParams =
	| {
			readonly mode: "sessions";
			readonly query?: string;
			readonly agent?: string;
			readonly allAgents?: boolean;
			readonly limit?: number;
			readonly cursor?: string;
			readonly tag?: "chat" | "cron";
	  }
	| {
			readonly mode: "transcript";
			readonly sessionRef: string;
			readonly agent?: string;
			readonly turns?: number;
			readonly full?: boolean;
			readonly includeEmpty?: boolean;
			readonly cursor?: string;
			readonly tag?: "chat" | "cron";
	  };

export interface OutclawSchemaParams {
	readonly mode: "all" | "stale";
	readonly agent?: string;
}

export type OutclawCronParams =
	| {
			readonly mode: "failed_status";
			readonly agent?: string;
			readonly jobName?: string;
			readonly namesOnly?: boolean;
			readonly sinceEpochMs?: number;
			readonly limit?: number;
	  }
	| {
			readonly mode: "run";
			readonly jobName: string;
			readonly agent?: string;
	  };

export type OutclawCodingParams =
	| {
			readonly mode: "list";
			readonly repository?: string;
			readonly includeArchived?: boolean;
			readonly limit?: number;
	  }
	| {
			readonly mode: "start";
			readonly target: string;
			readonly prompt: string;
			readonly cwd?: string;
	  }
	| {
			readonly mode: "resume";
			readonly sessionRef: string;
			readonly prompt: string;
	  }
	| {
			readonly mode: "status";
			readonly sessionRef: string;
			readonly block?: boolean;
			readonly timeoutSeconds?: number;
	  }
	| {
			readonly mode: "transcript";
			readonly sessionRef: string;
			readonly turns?: number;
			readonly full?: boolean;
			readonly cursor?: string;
			readonly eventTypes?: readonly string[];
			readonly includeToolOutputs?: boolean;
	  }
	| {
			readonly mode: "cancel";
			readonly sessionRef: string;
	  };

export type OutclawNativeToolParams =
	| OutclawPeerMessageParams
	| OutclawMemoryNoteParams
	| OutclawRecallParams
	| OutclawSchemaParams
	| OutclawCronParams
	| OutclawCodingParams;

export type OutclawPeerMessageData =
	| {
			readonly mode: "list";
			readonly agents: readonly {
				readonly agentId: string;
				readonly name: string;
				readonly current: boolean;
			}[];
	  }
	| {
			readonly mode: "ask" | "send";
			readonly targetAgent: string;
			readonly accepted: boolean;
			readonly responseText?: string;
			readonly sessionRef?: string;
	  };

export interface OutclawMemoryNoteData {
	readonly path: string;
	readonly title?: string;
	readonly timestamp: number;
	readonly sessionRef?: string;
}

export type OutclawRecallData =
	| {
			readonly mode: "sessions";
			readonly sessions: readonly {
				readonly sessionRef: string;
				readonly providerId: string;
				readonly agentId: string;
				readonly title: string;
				readonly model?: string;
				readonly tag: "chat" | "cron";
				readonly lastActiveAt: number;
				readonly matches?: readonly {
					readonly role: "user" | "assistant";
					readonly content: string;
					readonly timestamp: number;
				}[];
			}[];
			readonly nextCursor?: string;
	  }
	| {
			readonly mode: "transcript";
			readonly sessionRef: string;
			readonly turns: readonly {
				readonly role: "user" | "assistant";
				readonly content: string;
				readonly timestamp: number;
			}[];
			readonly truncated?: boolean;
			readonly omittedTurns?: number;
			readonly nextCursor?: string;
	  };

export interface OutclawSchemaData {
	readonly mode: "all" | "stale";
	readonly schemas: readonly {
		readonly name: string;
		readonly path: string;
		readonly description?: string;
		readonly lastObservationAt?: string;
		readonly lastSynthesized?: string;
		readonly status: "fresh" | "stale" | "unknown";
	}[];
}

export type OutclawCronData =
	| {
			readonly mode: "failed_status";
			readonly failures: readonly {
				readonly jobName: string;
				readonly sessionRef?: string;
				readonly startedAt: number;
				readonly error: string;
			}[];
			readonly jobNames?: readonly string[];
	  }
	| {
			readonly mode: "run";
			readonly jobName: string;
			readonly accepted: boolean;
			readonly sessionRef?: string;
	  };

export type OutclawCodingData =
	| {
			readonly mode: "list";
			readonly repositories: readonly {
				readonly id: string;
				readonly rootCwd: string;
				readonly displayName: string;
				readonly source: string;
				readonly status: string;
				readonly lastActiveAt: number;
			}[];
			readonly sessions: readonly {
				readonly sessionRef: string;
				readonly providerId: string;
				readonly sdkSessionId: string;
				readonly title?: string;
				readonly status: "running" | "idle" | "failed" | "cancelled";
				readonly cwd: string;
				readonly repositoryId?: string;
				readonly linkedChatSessionId?: string;
				readonly lastActiveAt: number;
			}[];
	  }
	| {
			readonly mode: "start" | "resume";
			readonly sessionRef: string;
			readonly status: "accepted" | "running" | "queued";
			readonly turnId?: string;
	  }
	| {
			readonly mode: "status";
			readonly sessionRef: string;
			readonly status: "running" | "idle" | "failed" | "cancelled";
			readonly summary?: string;
			readonly cwd?: string;
			readonly repositoryId?: string;
			readonly linkedChatSessionId?: string;
			readonly lastActiveAt?: number;
			readonly lastPrompt?: string;
			readonly finalResponse?: string;
			readonly error?: string;
	  }
	| {
			readonly mode: "transcript";
			readonly sessionRef: string;
			readonly events: readonly Record<string, unknown>[];
			readonly truncated?: boolean;
			readonly omittedEvents?: number;
			readonly nextCursor?: string;
	  }
	| {
			readonly mode: "cancel";
			readonly sessionRef: string;
			readonly cancelled: boolean;
	  };

export interface OutclawNativeToolContext {
	readonly agentId: string;
	readonly agentName: string;
	readonly providerSessionRef?: string;
	readonly source:
		| "browser"
		| "tui"
		| "telegram"
		| "cron"
		| "heartbeat"
		| "rollover"
		| "auto-title"
		| "agent";
	readonly readOnly: boolean;
}

export interface OutclawNativeToolHost {
	readonly context: OutclawNativeToolContext;
	peerMessage(
		params: OutclawPeerMessageParams,
	): Promise<NativeToolResult<OutclawPeerMessageData>>;
	memoryNote(
		params: OutclawMemoryNoteParams,
	): Promise<NativeToolResult<OutclawMemoryNoteData>>;
	recall(
		params: OutclawRecallParams,
	): Promise<NativeToolResult<OutclawRecallData>>;
	schema(
		params: OutclawSchemaParams,
	): Promise<NativeToolResult<OutclawSchemaData>>;
	cron(params: OutclawCronParams): Promise<NativeToolResult<OutclawCronData>>;
	coding(
		params: OutclawCodingParams,
	): Promise<NativeToolResult<OutclawCodingData>>;
}

const MAX_RECALL_SESSION_LIMIT = 100;
const MAX_TRANSCRIPT_TURNS = 500;
const MAX_NATIVE_TOOL_TIMEOUT_SECONDS = 300;

export function validateOutclawNativeToolParams(
	toolName: OutclawNativeToolName,
	params: unknown,
): NativeToolResult<OutclawNativeToolParams> {
	const recordResult = requireRecord(params);
	if (!recordResult.ok) {
		return recordResult;
	}

	const record = recordResult.data;
	switch (toolName) {
		case "outclaw_peer_message":
			return validatePeerMessageParams(record);
		case "outclaw_memory_note":
			return validateMemoryNoteParams(record);
		case "outclaw_recall":
			return validateRecallParams(record);
		case "outclaw_schema":
			return validateSchemaParams(record);
		case "outclaw_cron":
			return validateCronParams(record);
		case "outclaw_coding":
			return validateCodingParams(record);
	}
}

function validatePeerMessageParams(
	record: Readonly<Record<string, unknown>>,
): NativeToolResult<OutclawPeerMessageParams> {
	const modeResult = requireMode(record, "mode", ["list", "ask", "send"]);
	if (!modeResult.ok) {
		return modeResult;
	}
	if (modeResult.data === "list") {
		const fieldResult = rejectFieldsOutsideMode(record, "list", ["mode"]);
		if (!fieldResult.ok) {
			return fieldResult;
		}
		return {
			ok: true,
			data: { mode: "list" },
		};
	}
	const fieldResult = rejectFieldsOutsideMode(record, modeResult.data, [
		"mode",
		"targetAgent",
		"message",
		"timeoutSeconds",
	]);
	if (!fieldResult.ok) {
		return fieldResult;
	}
	const targetAgentResult = requireNonEmptyString(record, "targetAgent");
	if (!targetAgentResult.ok) {
		return targetAgentResult;
	}
	const messageResult = requireNonEmptyString(record, "message");
	if (!messageResult.ok) {
		return messageResult;
	}
	const timeoutResult = optionalBoundedPositiveNumber(
		record,
		"timeoutSeconds",
		MAX_NATIVE_TOOL_TIMEOUT_SECONDS,
	);
	if (!timeoutResult.ok) {
		return timeoutResult;
	}
	if (modeResult.data === "send" && "timeoutSeconds" in record) {
		return validationError("timeoutSeconds is valid only for mode ask");
	}

	return {
		ok: true,
		data: {
			mode: modeResult.data,
			targetAgent: targetAgentResult.data,
			message: messageResult.data,
			...(timeoutResult.data === undefined
				? {}
				: { timeoutSeconds: timeoutResult.data }),
		},
	};
}

function validateMemoryNoteParams(
	record: Readonly<Record<string, unknown>>,
): NativeToolResult<OutclawMemoryNoteParams> {
	if ("mode" in record) {
		return validationError("outclaw_memory_note does not accept a mode");
	}
	const fieldResult = rejectUnknownFields(record, [
		"text",
		"salience",
		"title",
		"tags",
	]);
	if (!fieldResult.ok) {
		return fieldResult;
	}
	const textResult = requireNonEmptyString(record, "text");
	if (!textResult.ok) {
		return textResult;
	}
	const titleResult = optionalNonEmptyString(record, "title");
	if (!titleResult.ok) {
		return titleResult;
	}
	const salienceResult = optionalEnum(record, "salience", [
		"correction",
		"confirmation",
		"decision",
		"surprise",
		"routine",
	]);
	if (!salienceResult.ok) {
		return salienceResult;
	}
	const tagsResult = optionalStringArray(record, "tags");
	if (!tagsResult.ok) {
		return tagsResult;
	}

	return {
		ok: true,
		data: {
			text: textResult.data,
			...(salienceResult.data === undefined
				? {}
				: { salience: salienceResult.data }),
			...(titleResult.data === undefined ? {} : { title: titleResult.data }),
			...(tagsResult.data === undefined ? {} : { tags: tagsResult.data }),
		},
	};
}

function validateRecallParams(
	record: Readonly<Record<string, unknown>>,
): NativeToolResult<OutclawRecallParams> {
	const modeResult = requireMode(record, "mode", ["sessions", "transcript"]);
	if (!modeResult.ok) {
		return modeResult;
	}
	const agentResult = optionalNonEmptyString(record, "agent");
	if (!agentResult.ok) {
		return agentResult;
	}
	const tagResult = optionalEnum(record, "tag", ["chat", "cron"]);
	if (!tagResult.ok) {
		return tagResult;
	}

	if (modeResult.data === "sessions") {
		const fieldResult = rejectFieldsOutsideMode(record, "sessions", [
			"mode",
			"query",
			"agent",
			"allAgents",
			"limit",
			"cursor",
			"tag",
		]);
		if (!fieldResult.ok) {
			return fieldResult;
		}
		const queryResult = optionalNonEmptyString(record, "query");
		if (!queryResult.ok) {
			return queryResult;
		}
		const allAgentsResult = optionalBoolean(record, "allAgents");
		if (!allAgentsResult.ok) {
			return allAgentsResult;
		}
		const limitResult = optionalBoundedInteger(
			record,
			"limit",
			1,
			MAX_RECALL_SESSION_LIMIT,
		);
		if (!limitResult.ok) {
			return limitResult;
		}
		const cursorResult = optionalNonEmptyString(record, "cursor");
		if (!cursorResult.ok) {
			return cursorResult;
		}
		return {
			ok: true,
			data: {
				mode: "sessions",
				...(queryResult.data === undefined ? {} : { query: queryResult.data }),
				...(agentResult.data === undefined ? {} : { agent: agentResult.data }),
				...(allAgentsResult.data === undefined
					? {}
					: { allAgents: allAgentsResult.data }),
				...(limitResult.data === undefined ? {} : { limit: limitResult.data }),
				...(cursorResult.data === undefined
					? {}
					: { cursor: cursorResult.data }),
				...(tagResult.data === undefined ? {} : { tag: tagResult.data }),
			},
		};
	}

	const fieldResult = rejectFieldsOutsideMode(record, "transcript", [
		"mode",
		"sessionRef",
		"agent",
		"turns",
		"full",
		"includeEmpty",
		"cursor",
		"tag",
	]);
	if (!fieldResult.ok) {
		return fieldResult;
	}
	const sessionRefResult = requireProviderQualifiedRef(record, "sessionRef");
	if (!sessionRefResult.ok) {
		return sessionRefResult;
	}
	const turnsResult = optionalBoundedInteger(
		record,
		"turns",
		1,
		MAX_TRANSCRIPT_TURNS,
	);
	if (!turnsResult.ok) {
		return turnsResult;
	}
	const fullResult = optionalBoolean(record, "full");
	if (!fullResult.ok) {
		return fullResult;
	}
	const includeEmptyResult = optionalBoolean(record, "includeEmpty");
	if (!includeEmptyResult.ok) {
		return includeEmptyResult;
	}
	const cursorResult = optionalNonEmptyString(record, "cursor");
	if (!cursorResult.ok) {
		return cursorResult;
	}
	if (turnsResult.data !== undefined && fullResult.data === true) {
		return validationError("Use either full or turns, not both");
	}
	return {
		ok: true,
		data: {
			mode: "transcript",
			sessionRef: sessionRefResult.data,
			...(agentResult.data === undefined ? {} : { agent: agentResult.data }),
			...(turnsResult.data === undefined ? {} : { turns: turnsResult.data }),
			...(fullResult.data === undefined ? {} : { full: fullResult.data }),
			...(includeEmptyResult.data === undefined
				? {}
				: { includeEmpty: includeEmptyResult.data }),
			...(cursorResult.data === undefined ? {} : { cursor: cursorResult.data }),
			...(tagResult.data === undefined ? {} : { tag: tagResult.data }),
		},
	};
}

function validateSchemaParams(
	record: Readonly<Record<string, unknown>>,
): NativeToolResult<OutclawSchemaParams> {
	const modeResult = requireMode(record, "mode", ["all", "stale"]);
	if (!modeResult.ok) {
		return modeResult;
	}
	const fieldResult = rejectFieldsOutsideMode(record, modeResult.data, [
		"mode",
		"agent",
	]);
	if (!fieldResult.ok) {
		return fieldResult;
	}
	const agentResult = optionalNonEmptyString(record, "agent");
	if (!agentResult.ok) {
		return agentResult;
	}

	return {
		ok: true,
		data: {
			mode: modeResult.data,
			...(agentResult.data === undefined ? {} : { agent: agentResult.data }),
		},
	};
}

function validateCronParams(
	record: Readonly<Record<string, unknown>>,
): NativeToolResult<OutclawCronParams> {
	const modeResult = requireMode(record, "mode", ["failed_status", "run"]);
	if (!modeResult.ok) {
		return modeResult;
	}
	const agentResult = optionalNonEmptyString(record, "agent");
	if (!agentResult.ok) {
		return agentResult;
	}

	if (modeResult.data === "failed_status") {
		const fieldResult = rejectFieldsOutsideMode(record, "failed_status", [
			"mode",
			"agent",
			"jobName",
			"namesOnly",
			"sinceEpochMs",
			"limit",
		]);
		if (!fieldResult.ok) {
			return fieldResult;
		}
		const jobNameResult = optionalNonEmptyString(record, "jobName");
		if (!jobNameResult.ok) {
			return jobNameResult;
		}
		const namesOnlyResult = optionalBoolean(record, "namesOnly");
		if (!namesOnlyResult.ok) {
			return namesOnlyResult;
		}
		const sinceResult = optionalPositiveNumber(record, "sinceEpochMs");
		if (!sinceResult.ok) {
			return sinceResult;
		}
		const limitResult = optionalBoundedInteger(record, "limit", 1, 100);
		if (!limitResult.ok) {
			return limitResult;
		}
		return {
			ok: true,
			data: {
				mode: "failed_status",
				...(agentResult.data === undefined ? {} : { agent: agentResult.data }),
				...(jobNameResult.data === undefined
					? {}
					: { jobName: jobNameResult.data }),
				...(namesOnlyResult.data === undefined
					? {}
					: { namesOnly: namesOnlyResult.data }),
				...(sinceResult.data === undefined
					? {}
					: { sinceEpochMs: sinceResult.data }),
				...(limitResult.data === undefined ? {} : { limit: limitResult.data }),
			},
		};
	}

	const fieldResult = rejectFieldsOutsideMode(record, "run", [
		"mode",
		"jobName",
		"agent",
	]);
	if (!fieldResult.ok) {
		return fieldResult;
	}
	const jobNameResult = requireNonEmptyString(record, "jobName");
	if (!jobNameResult.ok) {
		return jobNameResult;
	}
	return {
		ok: true,
		data: {
			mode: "run",
			jobName: jobNameResult.data,
			...(agentResult.data === undefined ? {} : { agent: agentResult.data }),
		},
	};
}

function validateCodingParams(
	record: Readonly<Record<string, unknown>>,
): NativeToolResult<OutclawCodingParams> {
	const modeResult = requireMode(record, "mode", [
		"list",
		"start",
		"resume",
		"status",
		"transcript",
		"cancel",
	]);
	if (!modeResult.ok) {
		return modeResult;
	}

	switch (modeResult.data) {
		case "list": {
			const fieldResult = rejectFieldsOutsideMode(record, "list", [
				"mode",
				"repository",
				"includeArchived",
				"limit",
			]);
			if (!fieldResult.ok) {
				return fieldResult;
			}
			const repositoryResult = optionalNonEmptyString(record, "repository");
			if (!repositoryResult.ok) {
				return repositoryResult;
			}
			const includeArchivedResult = optionalBoolean(record, "includeArchived");
			if (!includeArchivedResult.ok) {
				return includeArchivedResult;
			}
			const limitResult = optionalBoundedInteger(record, "limit", 1, 100);
			if (!limitResult.ok) {
				return limitResult;
			}
			return {
				ok: true,
				data: {
					mode: "list",
					...(repositoryResult.data === undefined
						? {}
						: { repository: repositoryResult.data }),
					...(includeArchivedResult.data === undefined
						? {}
						: { includeArchived: includeArchivedResult.data }),
					...(limitResult.data === undefined
						? {}
						: { limit: limitResult.data }),
				},
			};
		}
		case "start": {
			const fieldResult = rejectFieldsOutsideMode(record, "start", [
				"mode",
				"target",
				"prompt",
				"cwd",
			]);
			if (!fieldResult.ok) {
				return fieldResult;
			}
			const targetResult = requireNonEmptyString(record, "target");
			if (!targetResult.ok) {
				return targetResult;
			}
			const promptResult = requireNonEmptyString(record, "prompt");
			if (!promptResult.ok) {
				return promptResult;
			}
			const cwdResult = optionalNonEmptyString(record, "cwd");
			if (!cwdResult.ok) {
				return cwdResult;
			}
			return {
				ok: true,
				data: {
					mode: "start",
					target: targetResult.data,
					prompt: promptResult.data,
					...(cwdResult.data === undefined ? {} : { cwd: cwdResult.data }),
				},
			};
		}
		case "resume": {
			const fieldResult = rejectFieldsOutsideMode(record, "resume", [
				"mode",
				"sessionRef",
				"prompt",
			]);
			if (!fieldResult.ok) {
				return fieldResult;
			}
			const sessionRefResult = requireProviderQualifiedRef(
				record,
				"sessionRef",
			);
			if (!sessionRefResult.ok) {
				return sessionRefResult;
			}
			const promptResult = requireNonEmptyString(record, "prompt");
			if (!promptResult.ok) {
				return promptResult;
			}
			return {
				ok: true,
				data: {
					mode: "resume",
					sessionRef: sessionRefResult.data,
					prompt: promptResult.data,
				},
			};
		}
		case "status": {
			const fieldResult = rejectFieldsOutsideMode(record, "status", [
				"mode",
				"sessionRef",
				"block",
				"timeoutSeconds",
			]);
			if (!fieldResult.ok) {
				return fieldResult;
			}
			const sessionRefResult = requireProviderQualifiedRef(
				record,
				"sessionRef",
			);
			if (!sessionRefResult.ok) {
				return sessionRefResult;
			}
			const blockResult = optionalBoolean(record, "block");
			if (!blockResult.ok) {
				return blockResult;
			}
			const timeoutResult = optionalBoundedPositiveNumber(
				record,
				"timeoutSeconds",
				MAX_NATIVE_TOOL_TIMEOUT_SECONDS,
			);
			if (!timeoutResult.ok) {
				return timeoutResult;
			}
			return {
				ok: true,
				data: {
					mode: "status",
					sessionRef: sessionRefResult.data,
					...(blockResult.data === undefined
						? {}
						: { block: blockResult.data }),
					...(timeoutResult.data === undefined
						? {}
						: { timeoutSeconds: timeoutResult.data }),
				},
			};
		}
		case "transcript": {
			const fieldResult = rejectFieldsOutsideMode(record, "transcript", [
				"mode",
				"sessionRef",
				"turns",
				"full",
				"cursor",
				"eventTypes",
				"includeToolOutputs",
			]);
			if (!fieldResult.ok) {
				return fieldResult;
			}
			const sessionRefResult = requireProviderQualifiedRef(
				record,
				"sessionRef",
			);
			if (!sessionRefResult.ok) {
				return sessionRefResult;
			}
			const turnsResult = optionalBoundedInteger(
				record,
				"turns",
				1,
				MAX_TRANSCRIPT_TURNS,
			);
			if (!turnsResult.ok) {
				return turnsResult;
			}
			const fullResult = optionalBoolean(record, "full");
			if (!fullResult.ok) {
				return fullResult;
			}
			const cursorResult = optionalNonEmptyString(record, "cursor");
			if (!cursorResult.ok) {
				return cursorResult;
			}
			const eventTypesResult = optionalStringArray(record, "eventTypes");
			if (!eventTypesResult.ok) {
				return eventTypesResult;
			}
			const includeToolOutputsResult = optionalBoolean(
				record,
				"includeToolOutputs",
			);
			if (!includeToolOutputsResult.ok) {
				return includeToolOutputsResult;
			}
			if (turnsResult.data !== undefined && fullResult.data === true) {
				return validationError("Use either full or turns, not both");
			}
			return {
				ok: true,
				data: {
					mode: "transcript",
					sessionRef: sessionRefResult.data,
					...(turnsResult.data === undefined
						? {}
						: { turns: turnsResult.data }),
					...(fullResult.data === undefined ? {} : { full: fullResult.data }),
					...(cursorResult.data === undefined
						? {}
						: { cursor: cursorResult.data }),
					...(eventTypesResult.data === undefined
						? {}
						: { eventTypes: eventTypesResult.data }),
					...(includeToolOutputsResult.data === undefined
						? {}
						: { includeToolOutputs: includeToolOutputsResult.data }),
				},
			};
		}
		case "cancel": {
			const fieldResult = rejectFieldsOutsideMode(record, "cancel", [
				"mode",
				"sessionRef",
			]);
			if (!fieldResult.ok) {
				return fieldResult;
			}
			const sessionRefResult = requireProviderQualifiedRef(
				record,
				"sessionRef",
			);
			if (!sessionRefResult.ok) {
				return sessionRefResult;
			}
			return {
				ok: true,
				data: {
					mode: "cancel",
					sessionRef: sessionRefResult.data,
				},
			};
		}
	}
}

function requireRecord(
	params: unknown,
): NativeToolResult<Readonly<Record<string, unknown>>> {
	if (typeof params !== "object" || params === null || Array.isArray(params)) {
		return validationError("params must be an object");
	}

	return { ok: true, data: params as Readonly<Record<string, unknown>> };
}

function requireMode<TMode extends string>(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
	allowedModes: readonly TMode[],
): NativeToolResult<TMode> {
	const value = record[fieldName];
	if (typeof value !== "string" || value.trim() === "") {
		return validationError(`${fieldName} is required`);
	}
	if (!allowedModes.includes(value as TMode)) {
		return validationError(
			`${fieldName} must be one of: ${allowedModes.join(", ")}`,
		);
	}
	return { ok: true, data: value as TMode };
}

function rejectFieldsOutsideMode(
	record: Readonly<Record<string, unknown>>,
	mode: string,
	allowedFieldNames: readonly string[],
): NativeToolResult<void> {
	const allowedFields = new Set(allowedFieldNames);
	for (const fieldName of Object.keys(record)) {
		if (!allowedFields.has(fieldName)) {
			return validationError(`${fieldName} is not valid for mode ${mode}`);
		}
	}
	return { ok: true, data: undefined };
}

function rejectUnknownFields(
	record: Readonly<Record<string, unknown>>,
	allowedFieldNames: readonly string[],
): NativeToolResult<void> {
	const allowedFields = new Set(allowedFieldNames);
	for (const fieldName of Object.keys(record)) {
		if (!allowedFields.has(fieldName)) {
			return validationError(`${fieldName} is not valid for this tool`);
		}
	}
	return { ok: true, data: undefined };
}

function requireNonEmptyString(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
): NativeToolResult<string> {
	const value = record[fieldName];
	if (typeof value !== "string" || value.trim() === "") {
		return validationError(`${fieldName} is required`);
	}
	return { ok: true, data: value };
}

function optionalNonEmptyString(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
): NativeToolResult<string | undefined> {
	if (!(fieldName in record)) {
		return { ok: true, data: undefined };
	}
	const value = record[fieldName];
	if (typeof value !== "string" || value.trim() === "") {
		return validationError(`${fieldName} must be a non-empty string`);
	}
	return { ok: true, data: value };
}

function optionalBoolean(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
): NativeToolResult<boolean | undefined> {
	if (!(fieldName in record)) {
		return { ok: true, data: undefined };
	}
	const value = record[fieldName];
	if (typeof value !== "boolean") {
		return validationError(`${fieldName} must be a boolean`);
	}
	return { ok: true, data: value };
}

function optionalEnum<TValue extends string>(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
	allowedValues: readonly TValue[],
): NativeToolResult<TValue | undefined> {
	if (!(fieldName in record)) {
		return { ok: true, data: undefined };
	}
	const value = record[fieldName];
	if (typeof value !== "string" || !allowedValues.includes(value as TValue)) {
		return validationError(
			`${fieldName} must be one of: ${allowedValues.join(", ")}`,
		);
	}
	return { ok: true, data: value as TValue };
}

function optionalPositiveNumber(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
): NativeToolResult<number | undefined> {
	if (!(fieldName in record)) {
		return { ok: true, data: undefined };
	}
	const value = record[fieldName];
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return validationError(`${fieldName} must be a positive number`);
	}
	return { ok: true, data: value };
}

function optionalBoundedPositiveNumber(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
	maximum: number,
): NativeToolResult<number | undefined> {
	const valueResult = optionalPositiveNumber(record, fieldName);
	if (!valueResult.ok || valueResult.data === undefined) {
		return valueResult;
	}
	if (valueResult.data > maximum) {
		return validationError(
			`${fieldName} must be a positive number no greater than ${maximum}`,
		);
	}
	return valueResult;
}

function optionalBoundedInteger(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
	minimum: number,
	maximum: number,
): NativeToolResult<number | undefined> {
	if (!(fieldName in record)) {
		return { ok: true, data: undefined };
	}
	const value = record[fieldName];
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		return validationError(
			`${fieldName} must be an integer between ${minimum} and ${maximum}`,
		);
	}
	return { ok: true, data: value };
}

function optionalStringArray(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
): NativeToolResult<readonly string[] | undefined> {
	if (!(fieldName in record)) {
		return { ok: true, data: undefined };
	}
	const value = record[fieldName];
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "string" || item.trim() === "")
	) {
		return validationError(
			`${fieldName} must be an array of non-empty strings`,
		);
	}
	return { ok: true, data: value as readonly string[] };
}

function requireProviderQualifiedRef(
	record: Readonly<Record<string, unknown>>,
	fieldName: string,
): NativeToolResult<string> {
	const valueResult = requireNonEmptyString(record, fieldName);
	if (!valueResult.ok) {
		return valueResult;
	}
	if (!/^[^/]+\/.+$/.test(valueResult.data)) {
		return validationError(`${fieldName} must be provider-qualified`);
	}
	return valueResult;
}

function validationError<T>(message: string): NativeToolResult<T> {
	return {
		ok: false,
		error: {
			code: "validation_error",
			message,
		},
	};
}
