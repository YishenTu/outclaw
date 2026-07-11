import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useRef,
} from "react";

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

interface DialogProps {
	ariaLabel: string;
	children: ReactNode;
	className: string;
	closeOnBackdrop?: boolean;
	initialFocusRef?: React.RefObject<HTMLElement | null>;
	onClose: () => void;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	preventClose?: boolean;
}

export function Dialog({
	ariaLabel,
	children,
	className,
	closeOnBackdrop = true,
	initialFocusRef,
	onClose,
	onKeyDown,
	preventClose = false,
}: DialogProps) {
	const dialogRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const previouslyFocused = document.activeElement;
		const target =
			initialFocusRef?.current ??
			dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
			dialogRef.current;
		target?.focus();
		return () => {
			if (previouslyFocused instanceof HTMLElement) {
				previouslyFocused.focus();
			}
		};
	}, [initialFocusRef]);

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		onKeyDown?.(event);
		if (event.defaultPrevented) {
			return;
		}
		if (event.key === "Escape" && !preventClose) {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key !== "Tab") {
			return;
		}
		const focusable = Array.from(
			dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
				[],
		);
		if (focusable.length === 0) {
			event.preventDefault();
			dialogRef.current?.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable.at(-1);
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	}

	function handleBackdropPointerDown(event: PointerEvent<HTMLDivElement>) {
		if (
			closeOnBackdrop &&
			!preventClose &&
			event.target === event.currentTarget
		) {
			onClose();
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/80 px-4 py-6 backdrop-blur-sm"
			onPointerDown={handleBackdropPointerDown}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-label={ariaLabel}
				aria-modal="true"
				tabIndex={-1}
				onKeyDown={handleKeyDown}
				className={className}
			>
				{children}
			</div>
		</div>
	);
}
