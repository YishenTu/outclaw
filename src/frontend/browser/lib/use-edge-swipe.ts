import { useEffect } from "react";

const EDGE_THRESHOLD_PX = 24;
const HORIZONTAL_THRESHOLD_PX = 60;
const MAX_VERTICAL_RATIO = 0.5;

export interface EdgeSwipeHandlers {
	/** Fired on a horizontal swipe from the left edge toward the right. */
	onSwipeRightFromLeftEdge?: () => void;
	/** Fired on a horizontal swipe from the right edge toward the left. */
	onSwipeLeftFromRightEdge?: () => void;
}

interface SwipeState {
	startX: number;
	startY: number;
	fromLeftEdge: boolean;
	fromRightEdge: boolean;
}

/**
 * Detects edge-anchored horizontal swipes on the document. Designed to mimic
 * iOS's native back-swipe pattern: only gestures that begin within the first
 * `EDGE_THRESHOLD_PX` of the left or right viewport edge are considered, and
 * they only fire if the horizontal distance dominates the vertical (≥60px
 * horizontal, vertical ≤ 50% of horizontal). Internal horizontal scroll
 * regions (code blocks, diffs) are unaffected because the user must start
 * the gesture at the screen edge — not within the scrollable region.
 *
 * Mobile-only by convention: pass `enabled={false}` on desktop.
 */
export function useEdgeSwipe(
	handlers: EdgeSwipeHandlers,
	enabled: boolean,
): void {
	useEffect(() => {
		if (!enabled) {
			return;
		}
		if (typeof window === "undefined") {
			return;
		}

		let state: SwipeState | null = null;

		const handleTouchStart = (event: TouchEvent) => {
			if (event.touches.length !== 1) {
				state = null;
				return;
			}
			const touch = event.touches[0];
			if (!touch) {
				state = null;
				return;
			}
			const fromLeft = touch.clientX <= EDGE_THRESHOLD_PX;
			const fromRight = touch.clientX >= window.innerWidth - EDGE_THRESHOLD_PX;
			if (!fromLeft && !fromRight) {
				state = null;
				return;
			}
			state = {
				startX: touch.clientX,
				startY: touch.clientY,
				fromLeftEdge: fromLeft,
				fromRightEdge: fromRight,
			};
		};

		const handleTouchEnd = (event: TouchEvent) => {
			const start = state;
			state = null;
			if (!start) {
				return;
			}
			const touch = event.changedTouches[0];
			if (!touch) {
				return;
			}
			const dx = touch.clientX - start.startX;
			const dy = touch.clientY - start.startY;
			const absDx = Math.abs(dx);
			const absDy = Math.abs(dy);
			if (absDx < HORIZONTAL_THRESHOLD_PX) {
				return;
			}
			if (absDy > absDx * MAX_VERTICAL_RATIO) {
				return;
			}
			if (start.fromLeftEdge && dx > 0) {
				handlers.onSwipeRightFromLeftEdge?.();
				return;
			}
			if (start.fromRightEdge && dx < 0) {
				handlers.onSwipeLeftFromRightEdge?.();
			}
		};

		const handleTouchCancel = () => {
			state = null;
		};

		document.addEventListener("touchstart", handleTouchStart, {
			passive: true,
		});
		document.addEventListener("touchend", handleTouchEnd, { passive: true });
		document.addEventListener("touchcancel", handleTouchCancel, {
			passive: true,
		});
		return () => {
			document.removeEventListener("touchstart", handleTouchStart);
			document.removeEventListener("touchend", handleTouchEnd);
			document.removeEventListener("touchcancel", handleTouchCancel);
		};
	}, [
		enabled,
		handlers.onSwipeRightFromLeftEdge,
		handlers.onSwipeLeftFromRightEdge,
	]);
}
