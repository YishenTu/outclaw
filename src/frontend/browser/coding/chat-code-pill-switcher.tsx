import { Code2, MessageSquare } from "lucide-react";
import type { BrowserAppMode } from "./coding-store.ts";

interface ChatCodePillSwitcherProps {
	active: BrowserAppMode;
	onSelect(mode: BrowserAppMode): void;
}

export function ChatCodePillSwitcher({
	active,
	onSelect,
}: ChatCodePillSwitcherProps) {
	return (
		<div
			role="tablist"
			aria-label="Switch between chat and code"
			// p-0 so the active highlight reaches the container border; the
			// subheader still constrains overall height to h-8.
			className="flex w-full items-stretch gap-px rounded-md bg-dark-900/60 p-0"
		>
			<PillTab
				active={active === "chat"}
				icon={<MessageSquare size={12} />}
				label="Chat"
				onSelect={() => onSelect("chat")}
			/>
			<PillTab
				active={active === "code"}
				icon={<Code2 size={12} />}
				label="Code"
				onSelect={() => onSelect("code")}
			/>
		</div>
	);
}

function PillTab({
	active,
	icon,
	label,
	onSelect,
}: {
	active: boolean;
	icon: React.ReactNode;
	label: string;
	onSelect(): void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onSelect}
			className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
				active
					? "bg-dark-800 text-dark-100"
					: "text-dark-400 hover:text-dark-100"
			}`}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}
