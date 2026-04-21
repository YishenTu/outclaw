import { useCallback, useEffect, useRef, useState } from "react";

const COPY_FEEDBACK_MS = 1200;

export function useCopyToClipboard(): {
	copied: boolean;
	copy: (value: string) => void;
} {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current !== null) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const copy = useCallback((value: string) => {
		if (typeof navigator === "undefined" || !navigator.clipboard) {
			return;
		}

		void navigator.clipboard
			.writeText(value)
			.then(() => {
				setCopied(true);
				if (timeoutRef.current !== null) {
					clearTimeout(timeoutRef.current);
				}
				timeoutRef.current = setTimeout(() => {
					setCopied(false);
					timeoutRef.current = null;
				}, COPY_FEEDBACK_MS);
			})
			.catch(() => {});
	}, []);

	return { copied, copy };
}
