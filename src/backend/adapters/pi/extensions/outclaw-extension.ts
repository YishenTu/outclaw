import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerDefaultTools from "./default-tools.ts";
import registerFastMode from "./fast-mode.ts";
import registerOutclawTools from "./outclaw-tools.ts";
import registerWebTools from "./web-tools.ts";

export default function registerOutclawExtension(pi: ExtensionAPI) {
	registerFastMode(pi);
	registerWebTools(pi);
	registerDefaultTools(pi);
	registerOutclawTools(pi);
}
