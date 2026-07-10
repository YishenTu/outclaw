import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { formatThinkingForDisplay } from "../../../../common/thinking-display.ts";
import { MarkdownContent } from "./markdown-content.tsx";

interface ThinkingBlockProps {
	content: string;
}

export function ThinkingContent({ content }: ThinkingBlockProps) {
	const displayContent = formatThinkingForDisplay(content);
	if (displayContent === "") {
		return null;
	}

	return (
		<div className="px-3 py-2 text-sm italic text-dark-500">
			<MarkdownContent
				content={displayContent}
				className="text-dark-500 prose-strong:text-dark-300"
			/>
		</div>
	);
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
	const [expanded, setExpanded] = useState(false);
	const renderBody = expanded || typeof window === "undefined";

	if (content.trim() === "") {
		return null;
	}

	return (
		<div className="overflow-hidden">
			<button
				type="button"
				onClick={() => setExpanded((current) => !current)}
				className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-dark-800/50"
			>
				<Brain className="h-4 w-4 shrink-0 text-dark-500" />
				<span className="font-mono-ui shrink-0 text-xs text-dark-500">
					Thinking
				</span>
				<span className="shrink-0">
					{expanded ? (
						<ChevronDown className="h-4 w-4 text-dark-500" />
					) : (
						<ChevronRight className="h-4 w-4 text-dark-500" />
					)}
				</span>
			</button>
			{renderBody && (
				<div className="bg-dark-950/50">
					<ThinkingContent content={content} />
				</div>
			)}
		</div>
	);
}
