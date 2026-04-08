export function createHeartbeatPrompt(_promptHomeDir: string): string {
	return "Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If the file is missing or nothing needs attention, reply HEARTBEAT_OK.";
}
