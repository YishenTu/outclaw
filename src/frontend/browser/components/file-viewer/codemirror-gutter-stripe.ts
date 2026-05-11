import { Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { FileLineStatus } from "./parse-file-line-status.ts";

const emptyFileLineStatus: FileLineStatus = {
	added: new Set(),
	deletedBefore: new Set(),
	modified: new Set(),
};

const setFileLineStatusEffect = StateEffect.define<
	FileLineStatus | undefined
>();

const fileLineStatusField = StateField.define<FileLineStatus>({
	create() {
		return emptyFileLineStatus;
	},
	update(status, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setFileLineStatusEffect)) {
				return effect.value ?? emptyFileLineStatus;
			}
		}
		return status;
	},
});

class StripeMarker extends GutterMarker {
	override readonly elementClass: string;

	constructor(elementClass: string) {
		super();
		this.elementClass = elementClass;
	}

	override eq(other: GutterMarker): boolean {
		return (
			other instanceof StripeMarker && other.elementClass === this.elementClass
		);
	}

	override toDOM(): HTMLElement {
		const marker = document.createElement("div");
		marker.className = this.elementClass;
		return marker;
	}
}

const addedMarker = new StripeMarker(
	"cm-file-line-marker cm-file-line-marker-added bg-success",
);
const modifiedMarker = new StripeMarker(
	"cm-file-line-marker cm-file-line-marker-modified bg-warning",
);
const deletedMarker = new StripeMarker(
	"cm-file-line-marker cm-file-line-marker-deleted bg-danger",
);

export function fileLineStatusGutter() {
	// Use `Prec.high` so this gutter sorts to the LEFT of basicSetup's line
	// numbers gutter — gives the IDE-style "thin colored bar at the editor's
	// left edge" effect instead of a second visible gutter column between
	// line numbers and content.
	return [
		fileLineStatusField,
		Prec.high(
			gutter({
				class: "cm-file-line-status-gutter",
				lineMarker(view, line) {
					const lineNumber = view.state.doc.lineAt(line.from).number;
					const status = view.state.field(fileLineStatusField);
					if (status.deletedBefore.has(lineNumber)) {
						return deletedMarker;
					}
					if (status.modified.has(lineNumber)) {
						return modifiedMarker;
					}
					if (status.added.has(lineNumber)) {
						return addedMarker;
					}
					return null;
				},
			}),
		),
		EditorView.theme({
			// Thin colored bar at the editor's left edge (VSCode convention),
			// followed by a small breathing-room gap before the line numbers.
			// 4px marker + 6px right gap = 10px total gutter width.
			".cm-file-line-status-gutter": {
				minWidth: "10px",
				paddingRight: "6px",
				width: "10px",
			},
			".cm-file-line-status-gutter .cm-gutterElement": {
				padding: 0,
			},
			".cm-file-line-marker": {
				display: "block",
				height: "20px",
				width: "4px",
			},
			// Deleted marker uses the same stripe shape as added/modified for
			// visual consistency — the wedge-shape was the only marker that
			// read as a different visual language.
			".cm-file-line-marker-deleted": {
				display: "block",
				height: "20px",
				width: "4px",
			},
		}),
	];
}

export function updateStripeStatus(
	view: EditorView,
	status: FileLineStatus | undefined,
) {
	view.dispatch({
		effects: setFileLineStatusEffect.of(status),
	});
}
