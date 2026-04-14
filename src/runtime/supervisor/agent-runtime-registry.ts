import type { AgentRuntime } from "../application/create-agent-runtime.ts";

export class AgentRuntimeRegistry {
	private readonly runtimesById = new Map<string, AgentRuntime>();
	private readonly runtimesByName = new Map<string, AgentRuntime>();

	constructor(runtimes: AgentRuntime[]) {
		if (runtimes.length === 0) {
			throw new Error("Supervisor requires at least one agent runtime");
		}

		for (const runtime of runtimes) {
			if (this.runtimesById.has(runtime.agentId)) {
				throw new Error(`Duplicate agent id: ${runtime.agentId}`);
			}
			if (this.runtimesByName.has(runtime.name)) {
				throw new Error(`Duplicate agent name: ${runtime.name}`);
			}

			this.runtimesById.set(runtime.agentId, runtime);
			this.runtimesByName.set(runtime.name, runtime);
		}
	}

	getById(agentId: string): AgentRuntime | undefined {
		return this.runtimesById.get(agentId);
	}

	getByName(name: string): AgentRuntime | undefined {
		return this.runtimesByName.get(name);
	}

	getDefault(): AgentRuntime {
		return this.list()[0] as AgentRuntime;
	}

	list(): AgentRuntime[] {
		return [...this.runtimesById.values()].sort((left, right) =>
			left.name.localeCompare(right.name),
		);
	}

	async stopAll(): Promise<void> {
		await Promise.all(this.list().map((runtime) => runtime.stop()));
	}
}
