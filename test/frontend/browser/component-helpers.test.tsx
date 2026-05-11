import { describe, expect, test } from "bun:test";
import {
	describeContextGaugeArc,
	formatContextTokenCount,
	resolveContextUsagePercentage,
} from "../../../src/frontend/browser/components/chat/context-gauge.tsx";
import { DropupMenu } from "../../../src/frontend/browser/components/chat/dropup-menu.tsx";
import { formatHeartbeatRemaining } from "../../../src/frontend/browser/components/chat/heartbeat-indicator.tsx";
import {
	formatEffortLabel,
	resolveCurrentEffort,
	resolveCurrentModelAlias,
	visibleEffortLevelsForModel,
} from "../../../src/frontend/browser/components/chat/model-selector.tsx";
import { FileTree } from "../../../src/frontend/browser/components/right-panel/file-tree.tsx";
import { GitGraph } from "../../../src/frontend/browser/components/right-panel/git/git-graph.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

describe("browser component helpers", () => {
	test("formats context gauge values and clamps percentage from token counts", () => {
		expect(formatContextTokenCount(999)).toBe("999");
		expect(formatContextTokenCount(1_200)).toBe("1k");
		expect(formatContextTokenCount(1_250_000)).toBe("1.3M");
		expect(
			resolveContextUsagePercentage({
				contextTokens: 250,
				contextWindow: 1_000,
				percentage: 90,
			}),
		).toBe(25);
		expect(
			resolveContextUsagePercentage({
				contextTokens: 2_000,
				contextWindow: 1_000,
				percentage: 10,
			}),
		).toBe(100);
		expect(
			resolveContextUsagePercentage({
				contextTokens: 0,
				contextWindow: 0,
				percentage: 42,
			}),
		).toBe(42);
		expect(describeContextGaugeArc(8, 8, 6, 240, 480)).toContain("A 6 6 0 1 0");
	});

	test("formats heartbeat countdown labels across seconds, minutes, and hours", () => {
		const now = Date.parse("2026-04-27T00:00:00.000Z");

		expect(formatHeartbeatRemaining(now + 12_000, now)).toBe("12s");
		expect(formatHeartbeatRemaining(now + 61_000, now)).toBe("2m");
		expect(formatHeartbeatRemaining(now + 3_600_000, now)).toBe("1h");
		expect(formatHeartbeatRemaining(now + 5_400_000, now)).toBe("1h 30m");
		expect(formatHeartbeatRemaining(now - 1_000, now)).toBe("0s");
	});

	test("resolves model selector aliases, efforts, and visible effort options", () => {
		expect(resolveCurrentModelAlias(null)).toBe("opus");
		expect(resolveCurrentModelAlias("claude-opus-4-7[1m]")).toBe("opus");
		expect(resolveCurrentModelAlias("sonnet")).toBe("sonnet");
		expect(resolveCurrentModelAlias("unknown-model")).toBe("opus");
		expect(resolveCurrentEffort(null)).toBe("medium");
		expect(resolveCurrentEffort("xhigh")).toBe("xhigh");
		expect(resolveCurrentEffort("turbo")).toBe("medium");
		expect(formatEffortLabel("xhigh")).toBe("XHigh");
		expect(visibleEffortLevelsForModel("opus")).toEqual([
			"max",
			"xhigh",
			"high",
			"medium",
			"low",
		]);
		expect(visibleEffortLevelsForModel("sonnet")).toEqual([
			"max",
			"high",
			"medium",
			"low",
		]);
	});

	test("renders generic dropup menus for empty and selectable states", () => {
		const emptyHtml = renderToStaticMarkup(
			<DropupMenu<string>
				items={[]}
				selectedIndex={0}
				onSelect={() => {}}
				renderItem={(item) => item}
				itemKey={(item) => item}
				emptyMessage="No commands"
			/>,
		);
		const menuHtml = renderToStaticMarkup(
			<DropupMenu
				items={["alpha", "beta"]}
				selectedIndex={1}
				onSelect={() => {}}
				renderItem={(item, active) => `${active ? ">" : ""}${item}`}
				itemKey={(item) => item}
			/>,
		);

		expect(emptyHtml).toContain("No commands");
		expect(menuHtml).toContain("&gt;beta");
		expect(menuHtml).toContain("bg-dark-800 text-dark-100");
		expect(menuHtml).toContain("text-dark-300 hover:bg-dark-800/70");
	});

	test("renders the Pierre file tree host for browser tree entries", () => {
		const html = renderToStaticMarkup(
			<FileTree
				agentId="agent-railly"
				entries={[
					{
						kind: "file",
						name: "AGENTS.md",
						path: "AGENTS.md",
						gitStatus: "modified",
					},
					{
						kind: "directory",
						name: "cron",
						path: "cron",
						children: [
							{
								kind: "file",
								name: "daily.yaml",
								path: "cron/daily.yaml",
							},
						],
					},
				]}
				onOpenFile={() => {}}
			/>,
		);

		expect(html).toContain("<file-tree-container");
		expect(html).toContain('class="block h-full min-h-0"');
		expect(html).toContain("--trees-item-height:30px");
		expect(html).not.toContain("lucide-chevron-right");
		expect(html).not.toContain("text-brand");
	});

	test("renders an empty git graph without invoking commit graph layout", () => {
		const html = renderToStaticMarkup(
			<GitGraph
				currentBranch="main"
				graph={{ commits: [], branchHeads: [] }}
			/>,
		);

		expect(html).toContain("No commit history yet.");
		expect(html).not.toContain("git-graph-canvas");
	});
});
