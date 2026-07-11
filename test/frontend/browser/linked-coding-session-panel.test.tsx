import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { parseHTML } from "linkedom";
import { act } from "react";
import { clearCodingSessionEventCache } from "../../../src/frontend/browser/coding/coding-session-event-cache.ts";
import {
	CODING_STORAGE_KEY,
	useCodingStore,
} from "../../../src/frontend/browser/coding/coding-store.ts";
import { LinkedCodingSessionPanel } from "../../../src/frontend/browser/coding/linked-coding-session-panel.tsx";
// @ts-expect-error react-dom is installed in the browser workspace.
import { createRoot } from "../../../src/frontend/browser/node_modules/react-dom/client.js";

const realDocument = globalThis.document;
const realFetch = globalThis.fetch;
const realWindow = globalThis.window;
const reactActScope = globalThis as typeof globalThis & {
	IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const realReactActEnvironment = reactActScope.IS_REACT_ACT_ENVIRONMENT;

function json(data: unknown): Response {
	return new Response(JSON.stringify(data), {
		headers: { "content-type": "application/json" },
	});
}

function requestPath(input: RequestInfo | URL): string {
	const raw =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.toString()
				: input.url;
	return new URL(raw, "http://localhost").pathname;
}

async function flushEffects() {
	for (let index = 0; index < 5; index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

async function waitFor(predicate: () => boolean, label: string) {
	for (let index = 0; index < 50; index += 1) {
		await flushEffects();
		if (predicate()) {
			return;
		}
	}
	throw new Error(`Timed out waiting for ${label}`);
}

describe("linked coding session panel", () => {
	beforeEach(() => {
		const { document, window } = parseHTML(
			'<html><body><div id="root"></div></body></html>',
		);
		Object.assign(globalThis, { document, window });
		Object.defineProperty(window, "location", {
			configurable: true,
			value: new URL("http://localhost"),
		});
		reactActScope.IS_REACT_ACT_ENVIRONMENT = true;
		useCodingStore.setState({
			codingModels: [],
			codingModelsLoaded: false,
			selectedModelId: undefined,
			selectedEffort: undefined,
			fastTierEnabled: false,
		});
		window.localStorage?.removeItem(CODING_STORAGE_KEY);
		clearCodingSessionEventCache();
	});

	afterEach(() => {
		globalThis.document = realDocument;
		globalThis.fetch = realFetch;
		globalThis.window = realWindow;
		if (realReactActEnvironment === undefined) {
			delete reactActScope.IS_REACT_ACT_ENVIRONMENT;
		} else {
			reactActScope.IS_REACT_ACT_ENVIRONMENT = realReactActEnvironment;
		}
		clearCodingSessionEventCache();
	});

	test("loads coding models when opened from a chat-linked tab", async () => {
		const requestedPaths: string[] = [];
		globalThis.fetch = mock(async (input: RequestInfo | URL) => {
			const path = requestPath(input);
			requestedPaths.push(path);
			if (path === "/api/coding/models") {
				return json({
					models: [
						{
							id: "gpt-5.5",
							model: "gpt-5.5",
							displayName: "GPT-5.5",
							description: "frontier",
							isDefault: true,
							defaultReasoningEffort: "medium",
							supportedReasoningEfforts: ["low", "medium", "high"],
							serviceTiers: [],
						},
					],
				});
			}
			if (path === "/api/coding/sessions/codex/code-1") {
				return json({
					providerId: "codex",
					sdkSessionId: "code-1",
					repositoryId: "repo-1",
					title: "Linked code task",
					model: "",
					lastActive: 2,
					cwd: "/repo",
					lifecycleStatus: "open",
					runStatus: "idle",
					createdAt: 1,
					source: "code",
					tag: "code",
					events: [],
				});
			}
			if (path === "/api/coding/repositories/repo-1") {
				return json({
					id: "repo-1",
					rootCwd: "/repo",
					displayName: "outclaw",
					source: "manual",
					status: "active",
					createdAt: 1,
					lastActive: 1,
				});
			}
			if (path === "/api/coding/repositories/repo-1/skills") {
				return json({ skills: [] });
			}
			throw new Error(`Unexpected request: ${path}`);
		}) as unknown as typeof fetch;

		const rootElement = document.getElementById("root");
		if (!rootElement) {
			throw new Error("Missing root element");
		}
		const root = createRoot(rootElement);

		try {
			await act(async () => {
				root.render(
					<LinkedCodingSessionPanel
						providerId="codex"
						repositoryId="repo-1"
						sdkSessionId="code-1"
						title="Linked code task"
					/>,
				);
				await flushEffects();
			});

			await waitFor(
				() => requestedPaths.includes("/api/coding/models"),
				"coding model catalog request",
			);
			expect(useCodingStore.getState().codingModels).toEqual([
				expect.objectContaining({ id: "gpt-5.5" }),
			]);
		} finally {
			await act(async () => {
				root.unmount();
			});
		}
	});
});
