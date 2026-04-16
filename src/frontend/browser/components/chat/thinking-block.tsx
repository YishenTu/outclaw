import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface ThinkingBlockProps {
	content: string;
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
	const [expanded, setExpanded] = useState(false);

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
			{expanded && (
				<div className="bg-dark-950/50">
					<div className="px-3 py-2 text-sm italic whitespace-pre-wrap break-words text-dark-500">
						{content}
					</div>
				</div>
			)}
		</div>
	);
}
