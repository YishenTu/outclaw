import { describe, expect, mock, test } from "bun:test";
import type {
	Facade,
	RuntimeStatusEvent,
	ServerEvent,
	TranscriptTurn,
} from "../../../src/common/protocol.ts";
import { RuntimeClientGateway } from "../../../src/runtime/application/gateway/runtime-client-gateway.ts";
import type { WsClient } from "../../../src/runtime/transport/client-hub.ts";

function createStatusEvent(): RuntimeStatusEvent {
	return {
		type: "runtime_status",
		model: "sonnet",
		effort: "high",
		running: false,
	};
}

function mockWs(): WsClient & { events: () => ServerEvent[] } {
	const sent: string[] = [];
	return {
		send(payload: string) {
			sent.push(payload);
		},
		events() {
			return sent.map((item) => JSON.parse(item) as ServerEvent);
		},
	} as WsClient & { events: () => ServerEvent[] };
}

function createFacade(overrides: Partial<Facade> = {}): Facade {
	return {
		providerId: "mock",
		async *run() {},
		...overrides,
	};
}

describe("RuntimeClientGateway", () => {
	test("requestSkills reports configured chat skill catalog errors", async () => {
		const gateway = new RuntimeClientGateway({
			cwd: "/tmp/outclaw",
			facade: createFacade(),
			getStatusEvent: createStatusEvent,
			listSkills() {
				throw new Error("skills exploded");
			},
		});
		const ws = mockWs();

		gateway.requestSkills(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toContainEqual({
			type: "error",
			message: "skills exploded",
		});
	});

	test("requestSkills uses the provider-neutral chat skill catalog", async () => {
		const chatSkills = mock(async () => [
			{ name: "agent-skill", description: "Agent skill" },
		]);
		const gateway = new RuntimeClientGateway({
			cwd: "/tmp/outclaw",
			facade: createFacade({
				providerId: "claude",
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				providerId: "codex",
			}),
			listSkills: chatSkills,
		});
		const ws = mockWs();

		gateway.requestSkills(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(chatSkills).toHaveBeenCalled();
		expect(ws.events()).toContainEqual({
			type: "skills_update",
			skills: [{ name: "agent-skill", description: "Agent skill" }],
		});
	});

	test("requestWorkspaceFiles emits workspace_files_update with listed entries", async () => {
		const gateway = new RuntimeClientGateway({
			cwd: "/tmp/outclaw",
			facade: createFacade(),
			getStatusEvent: createStatusEvent,
			listWorkspaceFiles: async () => [
				{ kind: "file", path: "README.md" },
				{ kind: "directory", path: "src" },
			],
		});
		const ws = mockWs();

		gateway.requestWorkspaceFiles(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toContainEqual({
			type: "workspace_files_update",
			entries: [
				{ kind: "file", path: "README.md" },
				{ kind: "directory", path: "src" },
			],
		});
	});

	test("requestWorkspaceFiles reports lister failures as error events", async () => {
		const gateway = new RuntimeClientGateway({
			cwd: "/tmp/outclaw",
			facade: createFacade(),
			getStatusEvent: createStatusEvent,
			listWorkspaceFiles: async () => {
				throw new Error("listing exploded");
			},
		});
		const ws = mockWs();

		gateway.requestWorkspaceFiles(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toContainEqual({
			type: "error",
			message: "listing exploded",
		});
	});

	test("requestWorkspaceFiles is a no-op when no lister is configured", async () => {
		const gateway = new RuntimeClientGateway({
			facade: createFacade(),
			getStatusEvent: createStatusEvent,
		});
		const ws = mockWs();

		gateway.requestWorkspaceFiles(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toEqual([]);
	});

	test("handleOpen reports history replay failures to the client", async () => {
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				readHistory() {
					throw new Error("history exploded");
				},
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				sessionId: "sdk-123",
			}),
		});
		const ws = mockWs();

		expect(() => gateway.handleOpen(ws)).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toEqual([
			{
				type: "runtime_status",
				model: "sonnet",
				effort: "high",
				running: false,
				sessionId: "sdk-123",
			},
			{
				type: "error",
				message: "Failed to replay history: history exploded",
			},
		]);
	});

	test("handleOpen includes the replay session id on history replay events", async () => {
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				async readHistory() {
					return [
						{
							kind: "chat" as const,
							role: "user" as const,
							content: "past question",
						},
					];
				},
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				sessionId: "sdk-123",
			}),
		});
		const ws = mockWs();

		gateway.handleOpen(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toContainEqual({
			type: "history_replay",
			providerId: "mock",
			sdkSessionId: "sdk-123",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "past question",
				},
			],
		});
	});

	test("handleOpen merges transcript timestamps into replayed chat messages", async () => {
		const turns: TranscriptTurn[] = [
			{
				role: "user",
				content: "past question",
				timestamp: Date.parse("2025-01-15T14:30:00.000Z"),
			},
			{
				role: "assistant",
				content: "past answer",
				timestamp: Date.parse("2025-01-15T14:31:04.000Z"),
			},
		];
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				async readHistory() {
					return [
						{
							kind: "chat" as const,
							role: "user" as const,
							content: "past question",
						},
						{
							kind: "chat" as const,
							role: "assistant" as const,
							content: "past answer",
						},
					];
				},
				async readTranscript() {
					return turns;
				},
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				sessionId: "sdk-123",
			}),
		});
		const ws = mockWs();

		gateway.handleOpen(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toContainEqual({
			type: "history_replay",
			providerId: "mock",
			sdkSessionId: "sdk-123",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "past question",
					timestamp: turns[0]?.timestamp,
				},
				{
					kind: "chat",
					role: "assistant",
					content: "past answer",
					timestamp: turns[1]?.timestamp,
				},
			],
		});
	});

	test("handleOpen annotates replay reader messages with transcript timestamps", async () => {
		const turns: TranscriptTurn[] = [
			{
				role: "user",
				content: "past question",
				timestamp: Date.parse("2025-01-15T14:30:00.000Z"),
			},
			{
				role: "assistant",
				content: "past answer",
				timestamp: Date.parse("2025-01-15T14:31:04.000Z"),
			},
		];
		const readReplay = mock(async () => [
			{
				kind: "chat" as const,
				role: "user" as const,
				content: "past question",
			},
			{
				kind: "chat" as const,
				role: "assistant" as const,
				content: "past answer",
			},
		]);
		const readTranscript = mock(async () => turns);
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				readReplay,
				readTranscript,
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				sessionId: "sdk-123",
			}),
		});
		const ws = mockWs();

		gateway.handleOpen(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(readReplay).toHaveBeenCalledWith("sdk-123");
		expect(readTranscript).toHaveBeenCalledWith("sdk-123");
		expect(ws.events()).toContainEqual({
			type: "history_replay",
			providerId: "mock",
			sdkSessionId: "sdk-123",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "past question",
					timestamp: turns[0]?.timestamp,
				},
				{
					kind: "chat",
					role: "assistant",
					content: "past answer",
					timestamp: turns[1]?.timestamp,
				},
			],
		});
	});

	test("handleOpen prefers a replay reader over history when available", async () => {
		const readReplay = mock(async () => [
			{
				kind: "chat" as const,
				role: "user" as const,
				content: "past question",
				timestamp: Date.parse("2025-01-15T14:30:00.000Z"),
			},
		]);
		const readHistory = mock(async () => []);
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				readHistory,
				readReplay,
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				sessionId: "sdk-123",
			}),
		});
		const ws = mockWs();

		gateway.handleOpen(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(readReplay).toHaveBeenCalledWith("sdk-123");
		expect(readHistory).not.toHaveBeenCalled();
		expect(ws.events()).toContainEqual({
			type: "history_replay",
			providerId: "mock",
			sdkSessionId: "sdk-123",
			messages: [
				{
					kind: "chat",
					role: "user",
					content: "past question",
					timestamp: Date.parse("2025-01-15T14:30:00.000Z"),
				},
			],
		});
	});

	test("handleOpen sends streaming sync after replay when the active session is still running", async () => {
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				async readHistory() {
					return [
						{
							kind: "chat" as const,
							role: "assistant" as const,
							content: "partial answer",
						},
					];
				},
			}),
			getStreamingSyncEvent: (_providerId, sessionId) => ({
				type: "streaming_sync",
				sdkSessionId: sessionId,
				text: "streamed",
				thinking: "thinking",
				images: [],
			}),
			getStatusEvent: () => ({
				...createStatusEvent(),
				sessionId: "sdk-123",
			}),
		});
		const ws = mockWs();

		gateway.handleOpen(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(ws.events()).toContainEqual({
			type: "streaming_sync",
			providerId: "mock",
			sdkSessionId: "sdk-123",
			text: "streamed",
			thinking: "thinking",
			images: [],
		});
	});

	test("handleOpen resolves history by provider when sdk session ids collide", async () => {
		const claudeRead = mock(async () => [
			{
				kind: "chat" as const,
				role: "assistant" as const,
				content: "claude history",
			},
		]);
		const codexRead = mock(async () => [
			{
				kind: "chat" as const,
				role: "assistant" as const,
				content: "codex history",
			},
		]);
		const codexFacade = createFacade({
			providerId: "codex",
			readHistory: codexRead,
		});
		const gateway = new RuntimeClientGateway({
			facade: createFacade({
				providerId: "claude",
				readHistory: claudeRead,
			}),
			resolveFacadeForSession: (providerId, sessionId) =>
				providerId === "codex" && sessionId === "same-sdk-id"
					? codexFacade
					: undefined,
			getStatusEvent: () => ({
				...createStatusEvent(),
				providerId: "codex",
				sessionId: "same-sdk-id",
			}),
		});
		const ws = mockWs();

		gateway.handleOpen(ws);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(codexRead).toHaveBeenCalledWith("same-sdk-id");
		expect(claudeRead).not.toHaveBeenCalled();
		expect(ws.events()).toContainEqual({
			type: "history_replay",
			providerId: "codex",
			sdkSessionId: "same-sdk-id",
			messages: [
				{
					kind: "chat",
					role: "assistant",
					content: "codex history",
				},
			],
		});
	});
});
