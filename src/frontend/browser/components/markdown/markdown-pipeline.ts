import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export const BROWSER_MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];

/**
 * KaTeX must run before syntax highlighting so math nodes are converted
 * before the generic code highlighter sees them.
 */
export const BROWSER_MARKDOWN_REHYPE_PLUGINS = [rehypeKatex, rehypeHighlight];
