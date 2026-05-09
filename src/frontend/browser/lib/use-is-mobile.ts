import { useEffect, useState } from "react";

const MOBILE_MAX_WIDTH_PX = 767;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

function getInitialIsMobile(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/**
 * Reactive hook that reports whether the viewport is in the mobile range
 * (`max-width: 767px`, i.e. below Tailwind's `md` breakpoint).
 */
export function useIsMobile(): boolean {
	const [isMobile, setIsMobile] = useState<boolean>(getInitialIsMobile);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
		const handler = (event: MediaQueryListEvent) => {
			setIsMobile(event.matches);
		};
		setIsMobile(mql.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	return isMobile;
}
