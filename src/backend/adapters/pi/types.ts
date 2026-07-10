import type { OutclawNativeToolHost } from "../../../common/native-tools.ts";
import type {
	AssistantMessageSegment,
	DisplayImage,
	ImageRef,
	ToolCallDetail,
	UsageInfo,
} from "../../../common/protocol.ts";

export interface PiDriver {
	run(params: PiDriverRunParams): AsyncIterable<PiDriverEvent>;
	readSession(sessionId: string): Promise<PiDriverSession>;
	getDefaultModel?(): Promise<string | undefined>;
	listModels?(): Promise<PiDriverModel[]>;
	listScopedModels?(): Promise<PiDriverModel[]>;
	dispose?(): Promise<void> | void;
}

export interface PiDriverRunParams {
	prompt: string;
	preferredSessionId?: string;
	resumeSessionId?: string;
	instructionMode: "provider_default" | "runtime_constructed";
	systemPrompt?: string;
	images?: ImageRef[];
	cwd?: string;
	skillRootDir?: string;
	model?: string;
	effort?: string;
	serviceTier?: string;
	stream?: boolean;
	readOnly?: boolean;
	ephemeral?: boolean;
	sessionEnv?: Record<string, string>;
	nativeToolHost?: OutclawNativeToolHost;
	abortSignal?: AbortSignal;
}

export type PiDriverEvent =
	| {
			type: "session_started";
			sessionId: string;
	  }
	| {
			type: "text_delta";
			text: string;
			sessionId?: string;
			timestamp?: number;
	  }
	| {
			type: "thinking_delta";
			text: string;
			blockId?: string;
			sessionId?: string;
			timestamp?: number;
	  }
	| {
			type: "status";
			message: string;
			sessionId?: string;
	  }
	| {
			type: "usage";
			usage: UsageInfo;
			sessionId?: string;
	  }
	| {
			type: "turn_aborted";
			sessionId?: string;
			timestamp?: number;
	  }
	| {
			type: "compaction_started";
			sessionId?: string;
	  }
	| {
			type: "compaction_finished";
			sessionId?: string;
	  }
	| {
			type: "tool_call_started";
			callId: string;
			toolKind: string;
			details?: ToolCallDetail[];
			sessionId?: string;
	  }
	| {
			type: "tool_call_completed";
			callId: string;
			toolKind: string;
			status?: string;
			details?: ToolCallDetail[];
			sessionId?: string;
	  }
	| {
			type: "error";
			message: string;
			sessionId?: string;
	  }
	| {
			type: "done";
			sessionId: string;
			durationMs: number;
			timestamp?: number;
			costUsd?: number;
			usage?: UsageInfo;
	  };

export interface PiDriverSession {
	id: string;
	messages: PiDriverMessage[];
	entries?: PiDriverSessionEntry[];
}

export type PiDriverSessionEntry =
	| {
			type: "message";
			message: PiDriverMessage;
	  }
	| {
			type: "compaction";
			timestamp?: number;
			tokensBefore?: number;
	  };

export type PiDriverMessage =
	| {
			role: "user";
			content: string;
			images?: DisplayImage[];
			timestamp?: number;
	  }
	| {
			role: "assistant";
			content?: string;
			thinking?: string;
			thinkingBlocks?: string[];
			segments?: AssistantMessageSegment[];
			timestamp?: number;
	  };

export interface PiDriverModel {
	id: string;
	model?: string;
	displayName?: string;
	description?: string;
	isDefault?: boolean;
	defaultReasoningEffort?: string;
	supportedReasoningEfforts?: string[];
	contextWindow?: number;
	serviceTiers?: Array<{
		id: string;
		name: string;
		description: string;
	}>;
}
