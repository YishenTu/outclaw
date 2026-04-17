import hljs from "highlight.js";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { BrowserFileResponse } from "../../../../common/protocol.ts";
import { fetchAgentFile } from "../../lib/api.ts";
import { useTabsStore } from "../../stores/tabs.ts";

interface FileViewerProps {
	tabId: string;
	path: string;
	agentId: string;
}

function isMarkdownFile(path: string): boolean {
	return path.toLowerCase().endsWith(".md");
}

function buildCodeFence(content: string, language?: string): string {
	const longestBacktickRun = Math.max(
		0,
		...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
	);
	const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
	return `${fence}${language ?? ""}\n${content}\n${fence}`;
}

export function CodePreview({
	content,
	language,
}: {
	content: string;
	language?: string;
}) {
	const markdown = useMemo(() => {
		const supportedLanguage =
			language && hljs.getLanguage(language) ? language : undefined;
		return buildCodeFence(content, supportedLanguage);
	}, [content, language]);

	return (
		<div className="prose prose-invert max-w-none text-dark-100 [&_pre]:m-0 [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:border-0 [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:text-[12px] [&_pre]:leading-5 [&_pre]:[overflow-wrap:anywhere] [&_pre_code]:bg-transparent [&_pre_code]:whitespace-pre-wrap">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
			>
				{markdown}
			</ReactMarkdown>
		</div>
	);
}

export function FileViewer({ tabId, path, agentId }: FileViewerProps) {
	const [file, setFile] = useState<BrowserFileResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshKey, setRefreshKey] = useState(0);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const scrollTop = useTabsStore((state) => state.scrollPositions[tabId] ?? 0);
	const setScrollPosition = useTabsStore((state) => state.setScrollPosition);

	useEffect(() => {
		let cancelled = false;
		const requestKey = refreshKey;
		setLoading(true);
		setError(null);

		void fetchAgentFile(agentId, path)
			.then((nextFile) => {
				if (!cancelled && requestKey === refreshKey) {
					setFile(nextFile);
				}
			})
			.catch((nextError) => {
				if (!cancelled && requestKey === refreshKey) {
					setError(
						nextError instanceof Error
							? nextError.message
							: "Failed to load file",
					);
					setFile(null);
				}
			})
			.finally(() => {
				if (!cancelled && requestKey === refreshKey) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [agentId, path, refreshKey]);

	const breadcrumb = useMemo(() => path.split("/"), [path]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		container.scrollTop = scrollTop;
	});

	return (
		<div className="flex h-full min-h-0 flex-col bg-dark-950">
			<div className="h-8 shrink-0 border-b border-dark-800 px-6">
				<div className="mx-auto flex h-full max-w-5xl items-center justify-between gap-4">
					<div className="min-w-0">
						<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
							{breadcrumb.join(" / ")}
						</div>
					</div>
					<button
						type="button"
						onClick={() => setRefreshKey((current) => current + 1)}
						className="font-mono-ui inline-flex items-center gap-2 rounded text-[11px] uppercase tracking-[0.14em] text-dark-400 transition-colors hover:text-dark-100"
					>
						<RefreshCw size={13} />
						Refresh
					</button>
				</div>
			</div>

			<div
				ref={containerRef}
				onScroll={(event) =>
					setScrollPosition(tabId, event.currentTarget.scrollTop)
				}
				className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
			>
				<div className="mx-auto max-w-5xl">
					{loading ? (
						<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500">
							Loading file…
						</div>
					) : error ? (
						<div className="flex items-start gap-3 border border-red-500/20 bg-red-500/10 px-4 py-4 text-red-200">
							<AlertCircle size={16} className="mt-0.5 shrink-0" />
							<div className="text-sm">{error}</div>
						</div>
					) : file?.kind === "binary" ? (
						<div className="border border-dark-800 bg-dark-900/40 px-5 py-4 text-sm text-dark-300">
							Binary file preview is not supported for `{path}`.
						</div>
					) : isMarkdownFile(path) ? (
						<div className="prose prose-invert prose-sm max-w-none text-dark-100">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								rehypePlugins={[rehypeHighlight]}
							>
								{file?.content ?? ""}
							</ReactMarkdown>
						</div>
					) : (
						<CodePreview
							content={file?.content ?? ""}
							language={file?.language}
						/>
					)}

					{file?.truncated && (
						<div className="font-mono-ui mt-4 text-[11px] uppercase tracking-[0.14em] text-dark-500">
							Preview truncated to 512 KB.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
