const HEARTBEAT_PROMPT_PREFIX =
	"Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history.";

const LEGACY_HEARTBEAT_PROMPT_SUFFIXES = [
	"If the file is missing or nothing needs attention, reply only `HEARTBEAT_OK`, no explaination.",
	"If you took any action or have anything to report, summarise briefly. Only reply `HEARTBEAT_OK` if you did nothing and have nothing to notify the user about.",
];

const CURRENT_HEARTBEAT_PROMPT_SUFFIX =
	"If you took any action or have anything to report, summarise briefly. If you did nothing and have nothing to notify the user about, reply with exactly `HEARTBEAT_OK` — no other text.";

export const CURRENT_HEARTBEAT_PROMPT = `${HEARTBEAT_PROMPT_PREFIX} ${CURRENT_HEARTBEAT_PROMPT_SUFFIX}`;

export const INDEX_FILTERED_HEARTBEAT_PROMPTS = [
	...LEGACY_HEARTBEAT_PROMPT_SUFFIXES.map(
		(suffix) => `${HEARTBEAT_PROMPT_PREFIX} ${suffix}`,
	),
	CURRENT_HEARTBEAT_PROMPT,
];
