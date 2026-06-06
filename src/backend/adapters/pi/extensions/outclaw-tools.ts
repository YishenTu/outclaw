import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OUTCLAW_NATIVE_TOOL_NAMES = [
	"outclaw_peer_message",
	"outclaw_memory_note",
	"outclaw_recall",
	"outclaw_schema",
	"outclaw_cron",
	"outclaw_coding",
] as const;

export default function outclawToolsExtension(_pi: ExtensionAPI) {
	// Runtime-bound tool registration is injected by the Outclaw Pi adapter.
	void OUTCLAW_NATIVE_TOOL_NAMES;
}
