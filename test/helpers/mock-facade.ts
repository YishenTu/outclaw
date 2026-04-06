import type {
	Facade,
	FacadeEvent,
	RunParams,
} from "../../src/common/protocol.ts";

const SESSION_ID = "mock-session-123";

export class MockFacade implements Facade {
	lastParams: RunParams | undefined;
	callCount = 0;

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.lastParams = params;
		this.callCount++;

		if (params.abortController?.signal.aborted) {
			yield { type: "error", message: "aborted" };
			return;
		}

		yield { type: "text", text: `echo: ${params.prompt}` };
		yield {
			type: "done",
			sessionId: SESSION_ID,
			durationMs: 1,
			costUsd: 0,
		};
	}
}
