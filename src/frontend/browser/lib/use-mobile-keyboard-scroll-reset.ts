import { useEffect } from "react";

const RESET_DELAY_MS = 50;

function isFormControl(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

/**
 * iOS Safari scrolls the document when an input is focused so the input sits
 * above the on-screen keyboard, but it does not undo that scroll when the
 * input blurs. The result is a phantom blank strip where the keyboard used
 * to be. This effect snaps the document back to the top whenever a form
 * control loses focus, so the layout always returns to its natural position.
 *
 * Mobile-only: skips entirely on desktop where the behavior doesn't apply.
 */
export function useMobileKeyboardScrollReset(enabled: boolean): void {
	useEffect(() => {
		if (!enabled) {
			return;
		}
		if (typeof window === "undefined") {
			return;
		}

		const handleFocusOut = (event: FocusEvent) => {
			if (!isFormControl(event.target)) {
				return;
			}
			// Defer until after the keyboard dismissal animation has started so
			// the scroll reset lands on the final layout, not the in-flight one.
			window.setTimeout(() => {
				window.scrollTo({ top: 0, left: 0, behavior: "auto" });
			}, RESET_DELAY_MS);
		};

		document.addEventListener("focusout", handleFocusOut);
		return () => document.removeEventListener("focusout", handleFocusOut);
	}, [enabled]);
}
