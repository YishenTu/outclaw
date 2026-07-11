import { afterEach, describe, expect, mock, test } from "bun:test";
import { useAgentFilesStore } from "../../../src/frontend/browser/stores/agent-files.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
	useAgentFilesStore.setState({
		entriesByAgent: {},
		errorByAgent: {},
		loadingByAgent: {},
		requestGenerationByAgent: {},
	});
});

describe("agent files store", () => {
	test("records request failures and allows retry", async () => {
		let attempt = 0;
		globalThis.fetch = mock(async () => {
			attempt += 1;
			if (attempt === 1) {
				return Response.json(
					{ error: "Workspace unavailable" },
					{ status: 503 },
				);
			}
			return Response.json([{ path: "README.md", kind: "file" }]);
		}) as unknown as typeof fetch;

		await useAgentFilesStore.getState().requestFiles("agent-railly");
		expect(useAgentFilesStore.getState().errorByAgent["agent-railly"]).toBe(
			"Workspace unavailable",
		);

		await useAgentFilesStore.getState().requestFiles("agent-railly");
		expect(
			useAgentFilesStore.getState().errorByAgent["agent-railly"],
		).toBeUndefined();
		expect(useAgentFilesStore.getState().getFiles("agent-railly")).toEqual([
			{ path: "README.md", kind: "file" },
		]);
	});

	test("deduplicates requests independently per agent", async () => {
		const resolvers = new Map<string, (response: Response) => void>();
		const requests: string[] = [];
		globalThis.fetch = mock(async (input: RequestInfo | URL) => {
			const path = String(input);
			const agentId = path.split("/")[3] ?? "";
			requests.push(agentId);
			return await new Promise<Response>((resolve) => {
				resolvers.set(agentId, resolve);
			});
		}) as unknown as typeof fetch;

		const firstA = useAgentFilesStore.getState().requestFiles("agent-a");
		const firstB = useAgentFilesStore.getState().requestFiles("agent-b");
		const duplicateA = useAgentFilesStore.getState().requestFiles("agent-a");
		expect(requests).toEqual(["agent-a", "agent-b"]);

		resolvers.get("agent-a")?.(Response.json([]));
		resolvers.get("agent-b")?.(Response.json([]));
		await Promise.all([firstA, firstB, duplicateA]);
	});

	test("ignores a response invalidated while in flight", async () => {
		let resolveRequest: ((response: Response) => void) | undefined;
		globalThis.fetch = mock(
			async () =>
				await new Promise<Response>((resolve) => {
					resolveRequest = resolve;
				}),
		) as unknown as typeof fetch;

		const request = useAgentFilesStore.getState().requestFiles("agent-a");
		useAgentFilesStore.getState().invalidate("agent-a");
		resolveRequest?.(Response.json([{ path: "stale.md", kind: "file" }]));
		await request;

		expect(useAgentFilesStore.getState().getFiles("agent-a")).toEqual([]);
	});
});
