import { useCallback, useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "./copy-text-to-clipboard.ts";

const COPY_FEEDBACK_MS = 1200;

export type ClipboardCopyStatus = "idle" | "copied" | "failed";

export function useCopyToClipboard(): {
	copied: boolean;
	failed: boolean;
	status: ClipboardCopyStatus;
	copy: (value: string) => void;
} {
	const [status, setStatus] = useState<ClipboardCopyStatus>("idle");
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current !== null) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const copy = useCallback((value: string) => {
		void copyTextToClipboard(value).then((copied) => {
			setStatus(copied ? "copied" : "failed");
			if (timeoutRef.current !== null) {
				clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = setTimeout(() => {
				setStatus("idle");
				timeoutRef.current = null;
			}, COPY_FEEDBACK_MS);
		});
	}, []);

	return {
		copied: status === "copied",
		failed: status === "failed",
		status,
		copy,
	};
}
