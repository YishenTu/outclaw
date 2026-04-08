import type {
	Facade,
	FacadeEvent,
	RunParams,
} from "../../src/common/protocol.ts";

const SESSION_ID = "mock-session-123";

export class MockFacade implements Facade {
	lastParams: RunParams | undefined;
	allParams: RunParams[] = [];
	callCount = 0;
	delayMs = 0;
	callOrder: string[] = [];
	textChunks: string[] | undefined;

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		this.lastParams = params;
		this.allParams.push({ ...params });
		this.callCount++;
		this.callOrder.push(params.prompt);

		if (params.abortController?.signal.aborted) {
			yield { type: "error", message: "aborted" };
			return;
		}

		if (this.delayMs > 0) {
			await new Promise((r) => setTimeout(r, this.delayMs));
		}

		if (this.textChunks) {
			for (const text of this.textChunks) {
				yield { type: "text", text };
			}
		} else {
			yield { type: "text", text: `echo: ${params.prompt}` };
		}
		yield {
			type: "done",
			sessionId: SESSION_ID,
			durationMs: 1,
			costUsd: 0,
		};
	}
}
