import { join } from "node:path";
import {
	type DisplayMessage,
	extractError,
	type Facade,
	type FacadeEvent,
	type ProviderModelInfo,
	type RunParams,
	type TranscriptTurn,
} from "../../../common/protocol.ts";
import { createPiDriver } from "./driver.ts";
import {
	projectPiDisplayMessages,
	projectPiTranscriptTurns,
} from "./history.ts";
import { projectPiModels } from "./models.ts";
import { ensurePiAgentWorkspace, ensurePiProfile } from "./setup.ts";
import { normalizePiStreamEvent } from "./stream-normalizer.ts";
import type { PiDriver, PiDriverRunParams } from "./types.ts";

interface PiAdapterOptions {
	driver?: PiDriver;
	setupProfile?: () => void;
}

export class PiAdapter implements Facade {
	readonly providerId = "pi";
	private readonly driver: PiDriver;
	private readonly setupProfile: () => void;

	constructor(options: PiAdapterOptions = {}) {
		this.driver = options.driver ?? createPiDriver();
		this.setupProfile = options.setupProfile ?? (() => ensurePiProfile());
	}

	prepareWorkspace(promptHomeDir: string): void {
		this.setupProfile();
		ensurePiAgentWorkspace(promptHomeDir);
	}

	async *run(params: RunParams): AsyncIterable<FacadeEvent> {
		try {
			for await (const event of this.driver.run(mapRunParams(params))) {
				yield normalizePiStreamEvent(event);
			}
		} catch (err) {
			yield { type: "error", message: extractError(err) };
		}
	}

	async readHistory(sessionId: string): Promise<DisplayMessage[]> {
		const session = await this.driver.readSession(sessionId);
		return projectPiDisplayMessages(session);
	}

	async readReplay(sessionId: string): Promise<DisplayMessage[]> {
		return this.readHistory(sessionId);
	}

	async readTranscript(sessionId: string): Promise<TranscriptTurn[]> {
		const session = await this.driver.readSession(sessionId);
		return projectPiTranscriptTurns(session);
	}

	async listModels(): Promise<ProviderModelInfo[]> {
		return projectPiModels((await this.driver.listModels?.()) ?? []);
	}

	async getDefaultModel(): Promise<string | undefined> {
		return await this.driver.getDefaultModel?.();
	}

	async listScopedModels(): Promise<ProviderModelInfo[]> {
		return projectPiModels(
			(await this.driver.listScopedModels?.()) ??
				(await this.driver.listModels?.()) ??
				[],
		);
	}

	async dispose(): Promise<void> {
		await this.driver.dispose?.();
	}
}

function mapRunParams(params: RunParams): PiDriverRunParams {
	const instructionPolicy = params.instructionPolicy ?? {
		mode: "provider_default",
	};
	if (
		instructionPolicy.mode === "runtime_constructed" &&
		!instructionPolicy.systemPrompt
	) {
		throw new Error(
			"Pi runtime-constructed instruction policy needs a system prompt",
		);
	}
	return {
		prompt: params.prompt,
		...(params.resume
			? { resumeSessionId: params.resume }
			: params.sessionId
				? { preferredSessionId: params.sessionId }
				: {}),
		instructionMode: instructionPolicy.mode,
		...(instructionPolicy.mode === "runtime_constructed"
			? { systemPrompt: instructionPolicy.systemPrompt }
			: {}),
		...(params.images !== undefined && params.images.length > 0
			? { images: params.images }
			: {}),
		...(params.cwd !== undefined ? { cwd: params.cwd } : {}),
		...(params.resourceHomeDir !== undefined
			? { skillRootDir: join(params.resourceHomeDir, "skills") }
			: {}),
		...(params.model !== undefined ? { model: params.model } : {}),
		...(params.effort !== undefined ? { effort: params.effort } : {}),
		...(params.serviceTier !== undefined
			? { serviceTier: params.serviceTier }
			: {}),
		...(params.stream !== undefined ? { stream: params.stream } : {}),
		...(params.executionMode === "read_only" ? { readOnly: true } : {}),
		...(params.ephemeral !== undefined ? { ephemeral: params.ephemeral } : {}),
		...(params.sessionEnv !== undefined
			? { sessionEnv: params.sessionEnv }
			: {}),
		...(params.nativeToolHost !== undefined
			? { nativeToolHost: params.nativeToolHost }
			: {}),
		...(params.abortController !== undefined
			? { abortSignal: params.abortController.signal }
			: {}),
	};
}
