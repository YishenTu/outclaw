import { Check, Copy, CopyX } from "lucide-react";
import { Children, isValidElement, type ReactNode } from "react";
import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";

interface CodeFenceProps {
	children?: ReactNode;
	className?: string;
}

export function CodeFence({ children, className }: CodeFenceProps) {
	const code = extractText(children);
	const canCopy = code.trim() !== "";
	const { copied, failed, copy } = useCopyToClipboard();
	const label = copied
		? "Copied code block"
		: failed
			? "Copy code block failed"
			: "Copy code block";
	const toneClass = copied
		? "text-success"
		: failed
			? "text-danger"
			: "text-dark-300 hover:text-dark-100";

	return (
		<pre className={`${className ?? ""} relative pr-20`}>
			<button
				type="button"
				onClick={() => copy(code)}
				disabled={!canCopy}
				aria-label={label}
				className={`absolute right-2 top-2 z-10 inline-flex items-center justify-center rounded bg-dark-950/85 p-1 backdrop-blur-sm transition-colors disabled:cursor-not-allowed disabled:text-dark-600 ${
					toneClass
				}`}
			>
				{copied ? (
					<Check size={11} strokeWidth={1.8} aria-hidden="true" />
				) : failed ? (
					<CopyX size={11} strokeWidth={1.8} aria-hidden="true" />
				) : (
					<Copy size={11} strokeWidth={1.8} aria-hidden="true" />
				)}
			</button>
			{children}
		</pre>
	);
}

function extractText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(extractText).join("");
	}

	if (isValidElement<{ children?: ReactNode }>(node)) {
		return extractText(node.props.children);
	}

	return Children.toArray(node).map(extractText).join("");
}
