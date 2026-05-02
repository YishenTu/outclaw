interface ClipboardWriter {
	writeText: (value: string) => Promise<void>;
}

interface ClipboardNavigator {
	clipboard?: ClipboardWriter;
}

interface ClipboardTextArea {
	readOnly: boolean;
	style: Partial<CSSStyleDeclaration>;
	value: string;
	focus: () => void;
	select: () => void;
	setAttribute: (name: string, value: string) => void;
	setSelectionRange: (start: number, end: number) => void;
}

interface ClipboardBody {
	appendChild: (element: ClipboardTextArea) => unknown;
	removeChild: (element: ClipboardTextArea) => unknown;
}

interface ClipboardDocument {
	activeElement?: { focus?: () => void } | null;
	body?: ClipboardBody | null;
	createElement: (tagName: "textarea") => ClipboardTextArea;
	execCommand?: (command: string) => boolean;
}

interface ClipboardCopyEnvironment {
	document?: ClipboardDocument;
	isSecureContext?: boolean;
	navigator?: ClipboardNavigator;
}

export async function copyTextToClipboard(
	value: string,
	environment = resolveClipboardEnvironment(),
): Promise<boolean> {
	if (canUseClipboardApi(environment)) {
		try {
			await environment.navigator.clipboard.writeText(value);
			return true;
		} catch {
			// Fall through to the user-gesture selection path.
		}
	}

	return copyWithTextareaSelection(value, environment.document);
}

function resolveClipboardEnvironment(): ClipboardCopyEnvironment {
	return {
		document:
			typeof document === "undefined"
				? undefined
				: (document as ClipboardDocument),
		isSecureContext:
			typeof window === "undefined" ? false : window.isSecureContext,
		navigator:
			typeof navigator === "undefined"
				? undefined
				: (navigator as ClipboardNavigator),
	};
}

function canUseClipboardApi(
	environment: ClipboardCopyEnvironment,
): environment is ClipboardCopyEnvironment & {
	navigator: { clipboard: ClipboardWriter };
} {
	return (
		environment.isSecureContext === true &&
		typeof environment.navigator?.clipboard?.writeText === "function"
	);
}

function copyWithTextareaSelection(
	value: string,
	document: ClipboardDocument | undefined,
): boolean {
	const body = document?.body;
	if (!body || typeof document.execCommand !== "function") {
		return false;
	}

	const previousActiveElement = document.activeElement;
	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.readOnly = true;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.top = "0";
	textarea.style.left = "-9999px";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";

	body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	textarea.setSelectionRange(0, value.length);

	try {
		return document.execCommand("copy") === true;
	} catch {
		return false;
	} finally {
		body.removeChild(textarea);
		if (typeof previousActiveElement?.focus === "function") {
			previousActiveElement.focus();
		}
	}
}
