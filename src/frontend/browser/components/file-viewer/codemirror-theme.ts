import { EditorView } from "@codemirror/view";

export const outclawCodeMirrorTheme = EditorView.theme(
	{
		"&": {
			backgroundColor: "var(--dark-950)",
			color: "var(--dark-100)",
			fontFamily: '"Share Tech Mono", "SFMono-Regular", monospace',
			fontSize: "12px",
		},
		".cm-content": {
			caretColor: "rgb(var(--brand))",
			lineHeight: "20px",
			padding: "0",
		},
		".cm-cursor": {
			borderLeftColor: "rgb(var(--brand))",
		},
		".cm-gutters": {
			backgroundColor: "var(--dark-950)",
			borderRight: "1px solid var(--dark-800)",
			color: "var(--dark-500)",
		},
		".cm-line": {
			padding: "0 0 0 12px",
		},
		".cm-lineNumbers .cm-gutterElement": {
			padding: "0 8px 0 0",
		},
		".cm-scroller": {
			fontFamily: "inherit",
			lineHeight: "20px",
		},
		"&.cm-focused": {
			outline: "none",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
			{
				backgroundColor: "var(--dark-800)",
			},
		".cm-activeLine": {
			backgroundColor: "transparent",
		},
		".cm-activeLineGutter": {
			backgroundColor: "transparent",
			color: "var(--dark-300)",
		},
	},
	{ dark: true },
);
