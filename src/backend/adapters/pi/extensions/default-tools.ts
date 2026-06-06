import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_CORE_TOOLS = ["read", "bash", "edit", "write"];
const EXTRA_DEFAULT_TOOLS = ["grep", "find", "ls", "web_search", "web_fetch"];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		const active = new Set(pi.getActiveTools());

		// Only extend Pi's normal YOLO default toolset. If you started Pi with an
		// explicit restricted tool mode, e.g. --tools read,grep,find,ls or --no-tools,
		// do not silently widen it.
		const looksLikeNormalDefault = DEFAULT_CORE_TOOLS.every((name) =>
			active.has(name),
		);
		if (!looksLikeNormalDefault) return;

		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		let changed = false;
		for (const name of EXTRA_DEFAULT_TOOLS) {
			if (available.has(name) && !active.has(name)) {
				active.add(name);
				changed = true;
			}
		}

		if (changed) pi.setActiveTools([...active]);
	});
}
