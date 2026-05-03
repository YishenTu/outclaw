import type {
	BrowserCronHistoryCursor,
	BrowserCronRunEntry,
	TranscriptTurn,
} from "../../../common/protocol.ts";
import type { SessionStore } from "../../persistence/session-store/session-store.ts";

interface ListCronRunsOptions {
	limit: number;
	before?: BrowserCronHistoryCursor;
	readTranscript?: (
		providerId: string,
		sessionId: string,
	) => Promise<TranscriptTurn[] | undefined>;
}

export interface CronHistoryPage {
	entries: BrowserCronRunEntry[];
	hasMore: boolean;
}

export async function listCronRunsForJob(
	store: SessionStore,
	jobName: string,
	options: ListCronRunsOptions,
): Promise<CronHistoryPage> {
	const rows = store.listCronRunsByTitle(jobName, {
		limit: options.limit + 1,
		before: options.before,
	});
	const hasMore = rows.length > options.limit;
	const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
	const entries = await hydrateMissingResultText(
		pageRows,
		options.readTranscript,
	);
	return { entries, hasMore };
}

async function hydrateMissingResultText(
	entries: BrowserCronRunEntry[],
	readTranscript: ListCronRunsOptions["readTranscript"],
): Promise<BrowserCronRunEntry[]> {
	if (!readTranscript) {
		return entries;
	}

	return await Promise.all(
		entries.map(async (entry) => {
			const transcript = await readTranscript(
				entry.providerId,
				entry.sessionId,
			).catch(() => undefined);
			if (!transcript || transcript.length === 0) {
				return entry;
			}

			const resultText = extractAssistantText(transcript);
			if (resultText === "") {
				return entry;
			}

			return {
				...entry,
				resultText,
			};
		}),
	);
}

function extractAssistantText(transcript: TranscriptTurn[]): string {
	return transcript
		.filter((turn) => turn.role === "assistant" && turn.content !== "")
		.map((turn) => turn.content)
		.join("\n");
}
