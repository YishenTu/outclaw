export function createHeartbeatPrompt(_promptHomeDir: string): string {
	return "Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If you took any action or have anything to report, summarise briefly. If you did nothing and have nothing to notify the user about, reply with exactly `HEARTBEAT_OK` — no other text.";
}
