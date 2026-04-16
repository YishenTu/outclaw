interface WelcomePageProps {
	title?: string;
	subtitle?: string;
}

export function WelcomePage({
	title = "OUTCLAW",
	subtitle = "Browser and TUI attach to the same runtime stream.",
}: WelcomePageProps) {
	return (
		<div className="flex h-full flex-1 items-center justify-center bg-dark-950 px-6">
			<div className="w-full max-w-3xl px-4 text-center">
				<div className="flex items-center justify-center gap-4 text-dark-500">
					<span className="h-px w-20 bg-dark-700" />
					<span className="font-mono-ui text-[11px] uppercase tracking-[0.24em]">
						browser frontend
					</span>
					<span className="h-px w-20 bg-dark-700" />
				</div>
				<div className="mt-8">
					<div className="font-display text-5xl font-semibold uppercase tracking-[0.34em] text-dark-100">
						OUTCLAW
					</div>
					<div className="font-display mt-4 text-2xl tracking-[0.08em] text-dark-200">
						{title}
					</div>
				</div>
				<p className="mx-auto mt-6 max-w-2xl text-sm leading-8 text-dark-400">
					{subtitle}
				</p>
			</div>
		</div>
	);
}
