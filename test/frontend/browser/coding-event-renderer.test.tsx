import { describe, expect, test } from "bun:test";
import type { CodingSessionEvent } from "../../../src/common/protocol.ts";
import {
	CodingEventView,
	isCodingTurnInFlight,
} from "../../../src/frontend/browser/coding/coding-event-renderer.tsx";
import type { CodingSessionEventStreamItem } from "../../../src/frontend/browser/lib/api.ts";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

function streamItem(
	sequence: number,
	event: unknown,
): CodingSessionEventStreamItem {
	return {
		providerId: "codex",
		sdkSessionId: "session-1",
		sequence,
		event: event as CodingSessionEvent,
		createdAt: sequence,
	};
}

function occurrences(haystack: string, needle: string): number {
	let count = 0;
	let index = 0;
	while (true) {
		const next = haystack.indexOf(needle, index);
		if (next === -1) {
			return count;
		}
		count += 1;
		index = next + needle.length;
	}
}

describe("CodingEventView command grouping", () => {
	test("renders a single command card when started and completed events share a callId", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "command_execution_started",
				callId: "call-1",
				command: "ls -la",
				cwd: "/repo",
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "command_execution_completed",
				callId: "call-1",
				exitCode: 0,
				durationMs: 12,
				output: "stdout line",
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// The command text appears twice per card: once truncated in the header
		// preview and once wrapped in the body's "input" section.
		expect(occurrences(html, "ls -la")).toBe(2);
		// The completed-state output should be present, but the header no
		// longer surfaces an exit/duration meta.
		expect(html).toContain("stdout line");
		expect(html).not.toContain("exit 0");
		expect(html).not.toContain("running…");
	});

	test("renders running state while only the started event has arrived", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "command_execution_started",
				callId: "call-1",
				command: "sleep 1",
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(occurrences(html, "sleep 1")).toBe(2);
		expect(html).toContain("running…");
	});

	test("keeps independent command callIds separate", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "command_execution_started",
				callId: "call-A",
				command: "echo A",
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "command_execution_started",
				callId: "call-B",
				command: "echo B",
				sessionId: "session-1",
			}),
			streamItem(3, {
				type: "command_execution_completed",
				callId: "call-A",
				exitCode: 0,
				sessionId: "session-1",
			}),
			streamItem(4, {
				type: "command_execution_completed",
				callId: "call-B",
				exitCode: 0,
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// Each card duplicates its command in header preview + body input.
		expect(occurrences(html, "echo A")).toBe(2);
		expect(occurrences(html, "echo B")).toBe(2);
	});

	test("flushes interleaved text and thinking deltas into separate groups", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "text", text: "hello ", sessionId: "session-1" }),
			streamItem(2, { type: "text", text: "world", sessionId: "session-1" }),
			streamItem(3, {
				type: "thinking",
				text: "considering",
				sessionId: "session-1",
			}),
			streamItem(4, { type: "text", text: "again", sessionId: "session-1" }),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// Consecutive text deltas collapse into one MarkdownContent block, and a
		// later text delta starts a new block after the thinking group.
		expect(html).toContain("hello world");
		expect(html).toContain("again");
		// Thinking is rendered through the chat-mode ThinkingBlock, which is
		// collapsed by default — the body text is not in static markup, but the
		// "Thinking" label that toggles it is.
		expect(html).toContain("Thinking");
	});

	test("renders user_prompt as a chat-mode user bubble", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "fix the tests" }),
			streamItem(2, { type: "text", text: "on it", sessionId: "session-1" }),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// The user prompt should appear once, and the assistant text should also
		// appear once via the shared chat Message component.
		expect(occurrences(html, "fix the tests")).toBe(1);
		expect(html).toContain("on it");
	});

	test("renders turn_aborted with the chat-mode interrupt indicator", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "fix the spinner" }),
			streamItem(2, {
				type: "turn_aborted",
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);

		expect(html).toContain("Request interrupted by user");
		expect(html).toContain("font-mono-ui");
		expect(html).toContain("uppercase");
		expect(html).not.toContain("&lt;turn_aborted&gt;");
	});

	test("wraps a command in a collapsible details element with command in summary", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "command_execution_started",
				callId: "call-1",
				command: "rg --files",
				cwd: "/repo",
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "command_execution_completed",
				callId: "call-1",
				exitCode: 0,
				durationMs: 8,
				output: "src/index.ts\nsrc/cli.ts",
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// Collapsible wrapper exists.
		expect(html).toContain("<details");
		expect(html).toContain("<summary");
		// Body content (output) is still in the DOM so users can grep / SSR works.
		expect(html).toContain("src/index.ts");
		expect(html).toContain("src/cli.ts");
	});

	test("renders a failing command with a danger style", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "command_execution_started",
				callId: "call-1",
				command: "false",
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "command_execution_completed",
				callId: "call-1",
				exitCode: 1,
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(html).toContain("text-danger");
	});

	test("renders command output deltas inside the command card", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "command_execution_started",
				callId: "call-1",
				command: "bun test",
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "command_execution_output",
				callId: "call-1",
				output: "running tests\n",
				sessionId: "session-1",
			}),
			streamItem(3, {
				type: "command_execution_completed",
				callId: "call-1",
				exitCode: 0,
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(occurrences(html, "bun test")).toBe(2);
		expect(html).toContain("running tests");
		expect(html).not.toContain("Event: command_execution_output");
	});

	test("renders a file_change_applied event with one entry per change", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "file_change_applied",
				callId: "call-fc",
				changes: [
					{
						path: "src/index.ts",
						kind: "update",
						diff: "@@\n-old\n+new",
					},
					{
						path: "src/old.ts",
						kind: "delete",
					},
				],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(occurrences(html, "src/index.ts")).toBe(1);
		expect(occurrences(html, "src/old.ts")).toBe(1);
	});

	test("colors diff lines by sign in a file change body", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "file_change_applied",
				callId: "call-fc",
				changes: [
					{
						path: "src/index.ts",
						kind: "update",
						diff: "@@ -1,3 +1,3 @@\n-old line\n+new line\n unchanged",
					},
				],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// Per-line diff coloring is in the rendered DOM.
		expect(html).toMatch(/text-(?:emerald|green)-\d{3}[^"]*">\+new line/);
		expect(html).toMatch(/text-(?:rose|red)-\d{3}[^"]*">-old line/);
	});

	test("renders a web_search tool block with the query in the summary", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "web_search_started",
				callId: "ws-1",
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "web_search_completed",
				callId: "ws-1",
				query: "openai codex cli",
				queries: ["openai codex cli"],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(html).toContain("<details");
		expect(html).toContain("web_search");
		expect(html).toContain("openai codex cli");
		// Should be paired by callId — only one block, not two.
		expect(occurrences(html, "openai codex cli")).toBe(1);
	});

	test("renders a subagent tool_call (collabAgentToolCall) with prompt and per-agent status", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "tool_call_started",
				callId: "call_spawn",
				toolKind: "collabAgentToolCall",
				payload: {
					tool: "spawnAgent",
					senderThreadId: "parent-thread",
					receiverThreadIds: [],
					prompt: "Worker test: create .context/note.txt with one line.",
					model: "gpt-5.4-mini",
					reasoningEffort: "low",
					agentsStates: {},
				},
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "tool_call_completed",
				callId: "call_spawn",
				toolKind: "collabAgentToolCall",
				status: "completed",
				payload: {
					tool: "spawnAgent",
					senderThreadId: "parent-thread",
					receiverThreadIds: ["child-1"],
					prompt: "Worker test: create .context/note.txt with one line.",
					model: "gpt-5.4-mini",
					reasoningEffort: "low",
					agentsStates: {
						"child-1": { status: "pendingInit", message: null },
					},
				},
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// Header should label this as a subagent / spawn, not generic JSON.
		expect(html).toContain("subagent");
		expect(html).toContain("spawn");
		// Prompt text appears in the body (not as raw JSON).
		expect(html).toContain(
			"Worker test: create .context/note.txt with one line.",
		);
		// Receiver agent id appears.
		expect(html).toContain("child-1");
		// No raw JSON dump of the payload object.
		expect(html).not.toContain('"agentsStates":');
		expect(html).not.toContain("collabAgentToolCall");
		// Single block (callId pairing).
		expect(occurrences(html, "<details")).toBe(1);
	});

	test("renders typed subagent events with prompt and per-agent status", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "subagent_tool_started",
				callId: "call_spawn",
				operation: "spawn",
				prompt: "Worker test: create .context/note.txt with one line.",
				model: "gpt-5.4-mini",
				reasoningEffort: "low",
				targetIds: [],
				agentStates: [],
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "subagent_tool_completed",
				callId: "call_spawn",
				operation: "spawn",
				status: "completed",
				prompt: "Worker test: create .context/note.txt with one line.",
				model: "gpt-5.4-mini",
				reasoningEffort: "low",
				targetIds: ["child-1"],
				agentStates: [{ agentId: "child-1", status: "completed" }],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(html).toContain("subagent");
		expect(html).toContain("spawn");
		expect(html).toContain(
			"Worker test: create .context/note.txt with one line.",
		);
		expect(html).toContain("child-1");
		expect(html).not.toContain("Event: subagent_tool_started");
		expect(html).not.toContain("Event: subagent_tool_completed");
		expect(occurrences(html, "<details")).toBe(1);
	});

	test("renders a subagent wait tool_call with the awaited agent's reply visible", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "tool_call_started",
				callId: "call_wait",
				toolKind: "collabAgentToolCall",
				payload: {
					tool: "wait",
					senderThreadId: "parent",
					receiverThreadIds: ["child-1"],
					prompt: null,
					agentsStates: {},
				},
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "tool_call_completed",
				callId: "call_wait",
				toolKind: "collabAgentToolCall",
				status: "completed",
				payload: {
					tool: "wait",
					senderThreadId: "parent",
					receiverThreadIds: ["child-1"],
					prompt: null,
					agentsStates: {
						"child-1": {
							status: "completed",
							message: "Created `.context/note.txt` with one line.",
						},
					},
				},
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(html).toContain("subagent");
		expect(html).toContain("wait");
		// The subagent's reply must be visible (this is the substantive content).
		expect(html).toContain("Created `.context/note.txt` with one line.");
		expect(html).toContain("child-1");
		expect(html).toContain("completed");
	});

	test("renders an update_plan tool_call with explanation and step statuses", () => {
		const planArgs = JSON.stringify({
			explanation:
				"Aligning the coding browser flow with the desired archived-session contract before editing.",
			plan: [
				{
					step: "Inspect current archived session selection, session rendering, and resume flow plus existing tests",
					status: "in_progress",
				},
				{
					step: "Add failing tests for archived-session open vs auto-restore-on-send behavior",
					status: "pending",
				},
				{
					step: "Implement the browser/store/session-view changes at the right ownership seam",
					status: "pending",
				},
				{
					step: "Run targeted tests and bun run check if feasible",
					status: "pending",
				},
			],
		});
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "tool_call_started",
				callId: "plan-1",
				toolKind: "update_plan",
				details: [{ label: "arguments", value: planArgs }],
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "tool_call_completed",
				callId: "plan-1",
				toolKind: "update_plan",
				status: "completed",
				details: [{ label: "output", value: "Plan updated" }],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(html).toContain("update_plan");
		expect(html).toContain(
			"Aligning the coding browser flow with the desired archived-session contract before editing.",
		);
		expect(html).toContain(
			"Inspect current archived session selection, session rendering, and resume flow plus existing tests",
		);
		expect(html).toContain(
			"Add failing tests for archived-session open vs auto-restore-on-send behavior",
		);
		// Status is encoded in the icon + color/italic styling, not as raw text.
		// The in-progress step should render with the amber italic emphasis used
		// by the reference TodoWrite renderer.
		expect(html).toMatch(
			/text-amber-400[^"]*italic[^>]*>\s*Inspect current archived session/,
		);
		// No raw status words or uppercase pills leak into the rendered card.
		expect(html).not.toContain("in_progress");
		expect(html).not.toMatch(/>PENDING</);
		expect(html).not.toMatch(/>IN_PROGRESS</);
		expect(html).not.toMatch(/>COMPLETED</);
		// The "Plan updated" output and the raw JSON arguments blob must not leak
		// into the rendered card — the specialized renderer replaces both.
		expect(html).not.toContain("Plan updated");
		expect(html).not.toContain('"explanation"');
		// One paired block, not two separate cards.
		expect(occurrences(html, "update_plan")).toBeGreaterThanOrEqual(1);
	});

	test("renders an update_plan completed step with check icon and dimmed text", () => {
		const planArgs = JSON.stringify({
			plan: [
				{ step: "Wire the renderer", status: "completed" },
				{ step: "Match the reference styling", status: "in_progress" },
			],
		});
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "tool_call_started",
				callId: "plan-2",
				toolKind: "update_plan",
				details: [{ label: "arguments", value: planArgs }],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// Completed step uses the CheckCircle2 icon (rendered as lucide-circle-check).
		expect(html).toContain("lucide-circle-check");
		// Completed step text is dimmed but readable — no strikethrough; the icon
		// alone signals completion.
		expect(html).not.toContain("line-through");
		expect(html).toContain("Wire the renderer");
		expect(html).toContain("Match the reference styling");
	});

	test("renders a generic tool_call block for unknown tool kinds", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "tool_call_started",
				callId: "tool-1",
				toolKind: "viewImage",
				details: [{ label: "path", value: "/tmp/preview.png" }],
				sessionId: "session-1",
			}),
			streamItem(2, {
				type: "tool_call_completed",
				callId: "tool-1",
				toolKind: "viewImage",
				status: "completed",
				details: [{ label: "path", value: "/tmp/preview.png" }],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(html).toContain("<details");
		// Tool kind appears in the header summary.
		expect(html).toContain("viewImage");
		// Projected details are visible in the body (single block, no JSON catch-all).
		expect(html).toContain("/tmp/preview.png");
		expect(html).not.toContain("Event: tool_call_started");
		expect(html).not.toContain("Event: tool_call_completed");
	});

	test("does not render a transcript block for image events", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "look" }),
			streamItem(2, {
				type: "image",
				path: "/Users/yishentu/Projects/claudian/Preview.png",
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// Image events from text-path extraction would be unrenderable raw JSON
		// in the browser (no backend endpoint serves arbitrary local paths).
		expect(html).not.toContain("Event: image");
		expect(html).not.toContain("Preview.png");
	});

	test("does not render a transcript block for usage_updated events", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "go" }),
			streamItem(2, {
				type: "usage_updated",
				usage: {
					inputTokens: 1234,
					outputTokens: 56,
					cacheCreationTokens: 0,
					cacheReadTokens: 0,
					contextWindow: 200_000,
					maxOutputTokens: 0,
					contextTokens: 1290,
					percentage: 0.65,
				},
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// The transcript should not surface the raw usage_updated event JSON.
		expect(html).not.toContain("usage_updated");
		expect(html).not.toContain("Event: usage_updated");
		expect(html).not.toContain("inputTokens");
	});

	test("renders a file change inside a collapsible details element", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, {
				type: "file_change_applied",
				callId: "call-fc",
				changes: [
					{
						path: "src/a.ts",
						kind: "add",
						diff: "+hello",
					},
				],
				sessionId: "session-1",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		expect(html).toContain("<details");
		expect(html).toContain("<summary");
	});

	test("done shows completed-work duration and keeps final-result copy affordance", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "go" }),
			streamItem(2, { type: "text", text: "done thinking", sessionId: "s" }),
			streamItem(3, { type: "done", sessionId: "s", durationMs: 1500 }),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// The freeform "Turn complete" status line is gone in favor of the chat
		// final-result copy affordance and the completed-work duration header.
		expect(html).not.toContain("Turn complete");
		expect(html).toContain("Works for 2s");
		expect(html).toContain("Copy final result");
	});

	test("collapses completed turn work behind a duration header before the final result", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "fix it" }),
			streamItem(2, {
				type: "text",
				text: "I will inspect first.",
				sessionId: "s",
			}),
			streamItem(3, {
				type: "command_execution_started",
				callId: "call-1",
				command: "bun test",
				sessionId: "s",
			}),
			streamItem(4, {
				type: "command_execution_completed",
				callId: "call-1",
				exitCode: 0,
				output: "all tests passed",
				sessionId: "s",
			}),
			streamItem(5, {
				type: "text",
				text: "Final result.",
				sessionId: "s",
			}),
			streamItem(6, { type: "done", sessionId: "s", durationMs: 683_000 }),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		const workHeaderIndex = html.indexOf("Works for 11m23s");
		const finalIndex = html.indexOf("Final result.");

		expect(workHeaderIndex).toBeGreaterThan(-1);
		expect(finalIndex).toBeGreaterThan(workHeaderIndex);
		expect(html).toContain("I will inspect first.");
		expect(html).toContain("bun test");
		expect(html).toContain("all tests passed");
	});

	test("keeps in-flight turn output expanded without a completed-work header", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "fix it" }),
			streamItem(2, {
				type: "text",
				text: "I will inspect first.",
				sessionId: "s",
			}),
			streamItem(3, {
				type: "command_execution_started",
				callId: "call-1",
				command: "bun test",
				sessionId: "s",
			}),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);

		expect(html).not.toContain("Works for");
		expect(html).toContain("I will inspect first.");
		expect(html).toContain("bun test");
	});
});

describe("isCodingTurnInFlight", () => {
	test("returns false on an empty event list", () => {
		expect(isCodingTurnInFlight([])).toBe(false);
	});

	test("returns true after user_prompt arrives without a terminal event", () => {
		expect(
			isCodingTurnInFlight([
				streamItem(1, { type: "user_prompt", text: "go" }),
				streamItem(2, { type: "text", text: "...", sessionId: "s" }),
			]),
		).toBe(true);
	});

	test("returns false once a done event arrives", () => {
		expect(
			isCodingTurnInFlight([
				streamItem(1, { type: "user_prompt", text: "go" }),
				streamItem(2, { type: "done", sessionId: "s" }),
			]),
		).toBe(false);
	});

	test("returns false once a turn_aborted event arrives", () => {
		expect(
			isCodingTurnInFlight([
				streamItem(1, { type: "user_prompt", text: "go" }),
				streamItem(2, { type: "turn_aborted", sessionId: "s" }),
			]),
		).toBe(false);
	});

	test("stays false when background command output arrives after done", () => {
		expect(
			isCodingTurnInFlight([
				streamItem(1, { type: "user_prompt", text: "go" }),
				streamItem(2, {
					type: "command_execution_started",
					callId: "call-bg",
					command: "sleep 30",
				}),
				streamItem(3, { type: "done", sessionId: "s" }),
				streamItem(4, {
					type: "command_execution_completed",
					callId: "call-bg",
					exitCode: 0,
				}),
			]),
		).toBe(false);
	});

	test("returns true again when a new user_prompt follows a previous done", () => {
		expect(
			isCodingTurnInFlight([
				streamItem(1, { type: "user_prompt", text: "first" }),
				streamItem(2, { type: "done", sessionId: "s" }),
				streamItem(3, { type: "user_prompt", text: "second" }),
			]),
		).toBe(true);
	});
});
