interface CenterPanelBreadcrumbProps {
	leading?: string | null;
	title?: string | null;
}

export function CenterPanelBreadcrumb({
	leading,
	title,
}: CenterPanelBreadcrumbProps) {
	if (!leading && !title) {
		return null;
	}

	const tooltip = [leading, title].filter(Boolean).join("/");
	const leadingClassName = title
		? "max-w-[45%] shrink-0 truncate text-parchment"
		: "min-w-0 flex-1 truncate text-parchment";

	return (
		<div
			className="flex min-w-0 max-w-full items-center overflow-hidden whitespace-nowrap font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-500"
			title={tooltip}
		>
			{leading ? <span className={leadingClassName}>{leading}</span> : null}
			{leading && title ? (
				<span className="shrink-0 px-2 text-dark-700">/</span>
			) : null}
			{title ? <span className="min-w-0 flex-1 truncate">{title}</span> : null}
		</div>
	);
}
