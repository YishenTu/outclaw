import type { RenderOptions } from "ink";
import { render } from "ink";
import { AgentOnboardingApp } from "./app.tsx";
import type { AgentOnboardingSubmission } from "./state.ts";

export { AgentOnboardingApp } from "./app.tsx";
export type { AgentOnboardingSubmission } from "./state.ts";

export async function runAgentOnboardingTui(
	existingCount = 0,
	renderOptions?: RenderOptions,
): Promise<AgentOnboardingSubmission | null> {
	let result: AgentOnboardingSubmission | null = null;
	const instance = render(
		<AgentOnboardingApp
			existingCount={existingCount}
			onCancel={() => {
				result = null;
			}}
			onSubmit={(submission) => {
				result = submission;
			}}
		/>,
		renderOptions,
	);

	await instance.waitUntilExit();
	instance.cleanup();
	return result;
}
