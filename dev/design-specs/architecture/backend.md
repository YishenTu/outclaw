# Backend

## Boundary

Runtime consumes a provider-neutral facade. It does not talk to the Claude SDK
directly.

Agent-runtime provider composition belongs to `src/index.ts`, which constructs
the facade and passes it into each runtime. Daemonless consumers such as
session transcript export may resolve a backend facade by stored `provider_id`
through a backend registry.

## Facade Contract

```ts
interface Facade {
	providerId: string;
	run(params: RunParams): AsyncIterable<FacadeEvent>;
	readHistory?(sessionId: string): Promise<DisplayMessage[]>;
	readTranscript?(sessionId: string): Promise<TranscriptTurn[]>;
	getSkills?(cwd?: string): Promise<SkillInfo[]>;
}
```

### `RunParams`

- `prompt` — user text
- `images` — provider-neutral local image refs
- `replyContext` — quoted replied-to text kept separate from prompt text
- `systemPrompt` — opaque assembled prompt string from runtime
- `abortController` — cancellation handle
- `resume` — provider session identifier
- `cwd` — working directory for tools
- `model` — resolved provider model id
- `effort` — normalized thinking effort
- `stream` — when `false`, read final assistant output instead of deltas

### `FacadeEvent`

The backend contract currently includes:

- `text`
- `thinking`
- `image`
- `status`
- `error`
- `done`
- `compacting_started`
- `compacting_finished`

The runtime treats these as normalized provider events. It must not infer
provider-native status fields itself.

The current Claude adapter emits text/thinking/done/error plus compaction
lifecycle. Runtime-level image extraction still happens later from normalized
assistant text.

## Claude Adapter

`src/backend/adapters/claude.ts` implements the facade for
`@anthropic-ai/claude-agent-sdk`.

### Run Path

For each run, the adapter:

1. Builds provider input from `prompt + images + replyContext`.
2. Calls `query()` with the assembled system prompt, optional resume id, cwd,
   resolved model, effort, and SDK settings.
3. Streams normalized facade events back to runtime.

Current adapter settings mirror the shipped runtime behavior:

- permissions bypassed at the SDK boundary
- `includePartialMessages` follows `stream`
- tool list is explicitly whitelisted
- auto-compaction settings are owned here, not in runtime

### Streaming

- `content_block_delta.text_delta` -> `text`
- `content_block_delta.thinking_delta` -> `thinking`
- assistant messages are used to flush any text/thinking that did not arrive as
  deltas
- result events become `done` with session metadata and the final merged usage
  snapshot

### Usage Normalization

Claude usage is normalized in two phases:

- main assistant messages (`parent_tool_use_id === null`) provide the input-side
  token counts used for `inputTokens`, cache tokens, `contextTokens`, and
  `outputTokens`
- result `modelUsage` provides the authoritative `contextWindow` and
  `maxOutputTokens`

The adapter must not trust result `usage` as the source of truth for context
consumption because it can aggregate subagent activity and inflate the visible
usage percentage. When multiple `modelUsage` entries are present, the adapter
matches the active model before patching the final `done.usage`.

### Compaction

Claude `system/status` events are mapped to normalized compaction lifecycle
events:

- `status === "compacting"` -> `compacting_started`
- `status === null` -> `compacting_finished`

The adapter also owns automatic `autoCompactWindow` calculation from the
resolved model's context window.

### Multimodal and Reply Context

Provider-neutral input is translated only at the backend boundary:

- text-only prompts stay plain text
- images are converted to Claude base64 image blocks
- reply context is encoded into provider-visible prompt content here and decoded
  here during history/transcript reads

Runtime must not know about Claude-specific multimodal payload shapes.

## History And Transcript Normalization

`src/backend/adapters/claude-history.ts` owns Claude transcript parsing.

### `readHistory()`

Returns provider-neutral `DisplayMessage[]` for frontend replay.

Loading policy:

- prefer raw Claude JSONL under `~/.claude/projects/`
- fall back to `getSessionMessages(..., { includeSystemMessages: true })`

Normalization rules:

- user text and user images become displayable chat messages
- reply-context envelopes are decoded back into `replyContext`
- thinking-only assistant blocks are buffered and merged forward
- compaction boundaries become `DisplaySystemMessage`
- tool-only noise, task-notification envelopes, and synthetic no-response
  records are filtered out

### `readTranscript()`

Returns provider-neutral `TranscriptTurn[]` for CLI transcript export.

Rules:

- preserve provider timestamps
- include only conversational user/assistant turns
- strip task-notification envelopes from conversational text before export
- exclude tool traces, thinking-only content, and compaction plumbing
- fail if a fallback source cannot provide valid timestamps

## Skill Discovery

The adapter owns skill discovery and caching.

- during normal runs, `system/init` updates the in-memory skill cache
- `getSkills()` returns cached skills when available
- if empty, `getSkills()` performs a one-shot local probe, captures
  `system/init`, aborts, and deletes the throwaway transcript file

This keeps skill enumeration backend-owned and provider-specific.

## Claude Workspace Setup

`ensureClaudeSkillsSymlink(promptHomeDir)` creates `.claude/skills -> ../skills`
so Claude can discover seeded skills inside each agent workspace.
