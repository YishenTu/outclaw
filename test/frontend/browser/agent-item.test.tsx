import { describe, expect, test } from "bun:test";
import { AgentItem } from "../../../src/frontend/browser/components/agent-sidebar/agent-item.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("AgentItem", () => {
	test("renders agent names as title-case labels in the default UI font", () => {
		const html = renderToStaticMarkup(
			<AgentItem
				activeSession={null}
				agent={{ agentId: "agent-railly", name: "railly" }}
				dropIndicator={null}
				isActive={true}
				isDragging={false}
				isExpanded={false}
				onAttachRow={() => {}}
				onClearSearch={() => {}}
				onLoadMore={() => {}}
				onLoadMoreSearch={() => {}}
				onRowPointerDown={() => {}}
				onSearch={() => {}}
				onToggle={() => {}}
				sessions={[]}
			/>,
		);

		expect(html).toContain(">Railly<");
		expect(html).toContain("truncate text-[15px]");
		expect(html).not.toContain("font-semibold");
		expect(html).not.toContain("truncate font-mono-ui text-[15px]");
		expect(html).not.toContain("uppercase");
		expect(html).not.toContain("truncate font-display text-[15px]");
		expect(html).not.toContain(">RAILLY<");
		expect(html).not.toContain(">railly<");
	});

	test("renders expanded empty agents with a no-session hint", () => {
		const html = renderToStaticMarkup(
			<AgentItem
				activeSession={null}
				agent={{ agentId: "agent-railly", name: "railly" }}
				dropIndicator="before"
				isActive={false}
				isDragging={true}
				isExpanded={true}
				onAttachRow={() => {}}
				onClearSearch={() => {}}
				onLoadMore={() => {}}
				onLoadMoreSearch={() => {}}
				onRowPointerDown={() => {}}
				onSearch={() => {}}
				onToggle={() => {}}
				sessions={[]}
			/>,
		);

		expect(html).toContain("No cached sessions for this agent yet.");
		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain("opacity-60");
		expect(html).toContain("border-dark-300/90");
	});

	test("renders expanded sessions and marks the active session", () => {
		const html = renderToStaticMarkup(
			<AgentItem
				activeSession={{
					agentId: "agent-railly",
					providerId: "mock",
					sdkSessionId: "sdk-active",
				}}
				agent={{ agentId: "agent-railly", name: "railly" }}
				dropIndicator="after"
				isActive={true}
				isDragging={false}
				isExpanded={true}
				onAttachRow={() => {}}
				onClearSearch={() => {}}
				onLoadMore={() => {}}
				onLoadMoreSearch={() => {}}
				onRowPointerDown={() => {}}
				onSearch={() => {}}
				onToggle={() => {}}
				sessions={[
					{
						agentId: "agent-railly",
						providerId: "mock",
						sdkSessionId: "sdk-active",
						title: "Active work",
						model: "mock-model",
						lastActive: Date.now(),
					},
					{
						agentId: "agent-railly",
						providerId: "mock",
						sdkSessionId: "sdk-old",
						title: "Older work",
						model: "mock-model",
						lastActive: Date.now() - 86_400_000,
					},
				]}
			/>,
		);

		expect(html).toContain("Active work");
		expect(html).toContain("Older work");
		expect(html).toContain('aria-label="Start new session for railly"');
		expect(html).toContain('aria-label="Delete session Active work"');
		expect(html).toContain("bg-brand");
		expect(html).toContain("absolute inset-y-1 left-0 z-20");
		expect(html).toContain("sticky top-0 z-10 bg-dark-950");
		expect(html).toContain("bg-dark-100");
		expect(html).toContain("bottom-0");
	});

	test("renders active search results with a load-more affordance", () => {
		const html = renderToStaticMarkup(
			<AgentItem
				activeSession={null}
				agent={{ agentId: "agent-railly", name: "railly" }}
				dropIndicator={null}
				isActive={true}
				isDragging={false}
				isExpanded={true}
				onAttachRow={() => {}}
				onClearSearch={() => {}}
				onLoadMore={() => {}}
				onLoadMoreSearch={() => {}}
				onRowPointerDown={() => {}}
				onSearch={() => {}}
				onToggle={() => {}}
				searchState={{
					query: "auth",
					nextCursor: { lastActive: 1, sdkSessionId: "sdk-auth" },
					sessions: [
						{
							agentId: "agent-railly",
							providerId: "mock",
							sdkSessionId: "sdk-auth",
							title: "Auth work",
							model: "mock-model",
							lastActive: Date.now(),
						},
					],
				}}
				sessions={[]}
			/>,
		);

		expect(html).toContain("Auth work");
		expect(html).toContain("Load more results");
		expect(html).toContain('placeholder="Search sessions"');
		expect(html).not.toContain("lucide-search shrink-0 text-dark-500");
		expect(html).not.toContain("No matching sessions.");
	});
});
