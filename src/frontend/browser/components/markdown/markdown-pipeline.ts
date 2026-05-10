import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkLenientStrong } from "./remark-lenient-strong.ts";
import { remarkWikilinks } from "./remark-wikilinks.ts";

export const BROWSER_MARKDOWN_REMARK_PLUGINS = [
	remarkGfm,
	remarkMath,
	remarkLenientStrong,
];

export const BROWSER_MARKDOWN_PROSE_REMARK_PLUGINS = [
	...BROWSER_MARKDOWN_REMARK_PLUGINS,
	remarkWikilinks,
];

/**
 * KaTeX must run before syntax highlighting so math nodes are converted
 * before the generic code highlighter sees them.
 */
export const BROWSER_MARKDOWN_REHYPE_PLUGINS = [rehypeKatex, rehypeHighlight];
