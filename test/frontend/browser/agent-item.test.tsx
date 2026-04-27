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
				onRowPointerDown={() => {}}
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
});
