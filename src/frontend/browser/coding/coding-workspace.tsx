import { CodingCenter } from "./coding-center.tsx";
import { useCodingDataLoader } from "./coding-data.ts";
import { CodingRightPanel } from "./coding-right-panel.tsx";
import { CodingSidebarContainer } from "./coding-sidebar-container.tsx";

export function CodingWorkspaceBootstrap() {
	useCodingDataLoader(true);
	return null;
}

export { CodingCenter, CodingRightPanel, CodingSidebarContainer };
