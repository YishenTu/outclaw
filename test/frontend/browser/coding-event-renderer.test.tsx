import { describe, expect, test } from "bun:test";
import {
	CodingEventView,
	isCodingTurnInFlight,
} from "../../../src/frontend/browser/coding/coding-event-renderer.tsx";
import type { CodingSessionEventStreamItem } from "../../../src/frontend/browser/lib/api.ts";
// @ts-expect-error react-dom is installed in the browser workspace.
import { renderToStaticMarkup } from "../../../src/frontend/browser/node_modules/react-dom/server.browser.js";

function streamItem(
	sequence: number,
	event: Record<string, unknown>,
): CodingSessionEventStreamItem {
	return {
		providerId: "codex",
		sdkSessionId: "session-1",
		sequence,
		event,
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
		// The command text should appear exactly once.
		expect(occurrences(html, "ls -la")).toBe(1);
		// And the completed-state markers should be present.
		expect(html).toContain("exit 0");
		expect(html).toContain("stdout line");
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
		expect(occurrences(html, "sleep 1")).toBe(1);
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
		expect(occurrences(html, "echo A")).toBe(1);
		expect(occurrences(html, "echo B")).toBe(1);
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

	test("done attaches a chat-mode utility-bar footer to the assistant text", () => {
		const events: CodingSessionEventStreamItem[] = [
			streamItem(1, { type: "user_prompt", text: "go" }),
			streamItem(2, { type: "text", text: "done thinking", sessionId: "s" }),
			streamItem(3, { type: "done", sessionId: "s", durationMs: 1500 }),
		];

		const html = renderToStaticMarkup(<CodingEventView events={events} />);
		// The freeform "Turn complete" status line is gone in favor of the chat
		// utility bar (duration label + copy affordance).
		expect(html).not.toContain("Turn complete");
		expect(html).toContain("2s");
		expect(html).toContain("Copy final result");
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
