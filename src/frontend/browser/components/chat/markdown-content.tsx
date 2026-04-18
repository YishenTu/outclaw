import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
	content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
	return (
		<ReactMarkdown
			className="prose prose-invert prose-sm max-w-none break-words leading-normal text-dark-100 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code::before]:content-none [&_code::after]:content-none [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_pre]:text-[1em] [&_pre_code]:whitespace-pre-wrap"
			remarkPlugins={[remarkGfm]}
			rehypePlugins={[rehypeHighlight]}
		>
			{content}
		</ReactMarkdown>
	);
}
