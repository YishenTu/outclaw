export interface ThinkingBlockDelta {
	text: string;
	blockId?: string;
}

export interface ThinkingBlockState {
	text: string;
	blocks: string[];
	currentBlockId?: string;
}

export interface ThinkingBlockSnapshot {
	text: string;
	blocks: string[];
	currentBlockId?: string;
}

export function createThinkingBlockState(
	snapshot: Partial<ThinkingBlockSnapshot> = {},
): ThinkingBlockState {
	return {
		text: snapshot.text ?? "",
		blocks: [...(snapshot.blocks ?? [])],
		currentBlockId: snapshot.currentBlockId,
	};
}

export function appendThinkingBlockDelta(
	state: ThinkingBlockState,
	delta: ThinkingBlockDelta,
): ThinkingBlockState {
	if (delta.text === "") {
		return createThinkingBlockState(state);
	}

	const blocks =
		state.blocks.length === 0 || state.currentBlockId !== delta.blockId
			? [...state.blocks, delta.text]
			: appendToLastBlock(state.blocks, delta.text);

	return {
		text: `${state.text}${delta.text}`,
		blocks,
		currentBlockId: delta.blockId,
	};
}

export function startsNewThinkingBlock(
	state: ThinkingBlockState,
	delta: ThinkingBlockDelta,
): boolean {
	return (
		delta.text !== "" &&
		state.text !== "" &&
		state.currentBlockId !== delta.blockId
	);
}

export function snapshotThinkingBlockState(
	state: ThinkingBlockState,
): ThinkingBlockSnapshot {
	return createThinkingBlockState(state);
}

export function effectiveThinkingBlocks(params: {
	text?: string;
	blocks?: readonly string[];
}): string[] {
	if (params.blocks && params.blocks.length > 0) {
		return [...params.blocks];
	}
	return params.text ? [params.text] : [];
}

export function distinctThinkingBlocks(params: {
	text?: string;
	blocks?: readonly string[];
}): string[] | undefined {
	const blocks = effectiveThinkingBlocks(params);
	return blocks.length > 1 ? blocks : undefined;
}

export class ThinkingBlockAccumulator {
	private state = createThinkingBlockState();

	append(delta: ThinkingBlockDelta): void {
		this.state = appendThinkingBlockDelta(this.state, delta);
	}

	clear(): void {
		this.state = createThinkingBlockState();
	}

	snapshot(): ThinkingBlockSnapshot {
		return snapshotThinkingBlockState(this.state);
	}
}

function appendToLastBlock(blocks: string[], text: string): string[] {
	const next = [...blocks];
	const lastIndex = next.length - 1;
	next[lastIndex] = `${next[lastIndex] ?? ""}${text}`;
	return next;
}
