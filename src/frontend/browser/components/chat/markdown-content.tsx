import ReactMarkdown from "react-markdown";
import {
	BROWSER_MARKDOWN_PROSE_REMARK_PLUGINS,
	BROWSER_MARKDOWN_REHYPE_PLUGINS,
} from "../markdown/markdown-pipeline.ts";
import { CodeFence } from "./code-fence.tsx";

interface MarkdownContentProps {
	className?: string;
	content: string;
}

export function MarkdownContent({ className, content }: MarkdownContentProps) {
	return (
		<ReactMarkdown
			className={`prose prose-invert prose-sm max-w-none break-words leading-normal text-dark-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code::before]:content-none [&_code::after]:content-none [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_pre]:text-[1em] [&_pre_code]:whitespace-pre-wrap${
				className ? ` ${className}` : ""
			}`}
			remarkPlugins={BROWSER_MARKDOWN_PROSE_REMARK_PLUGINS}
			rehypePlugins={BROWSER_MARKDOWN_REHYPE_PLUGINS}
			components={{
				pre(props) {
					return (
						<CodeFence className={props.className}>{props.children}</CodeFence>
					);
				},
			}}
		>
			{content}
		</ReactMarkdown>
	);
}
