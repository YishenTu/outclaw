import { CURRENT_HEARTBEAT_PROMPT } from "../../common/heartbeat-prompt.ts";

export function createHeartbeatPrompt(_promptHomeDir: string): string {
	return CURRENT_HEARTBEAT_PROMPT;
}
