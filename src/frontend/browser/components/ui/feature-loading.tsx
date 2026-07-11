export function FeatureLoading({ label }: { label: string }) {
	return (
		<div
			aria-live="polite"
			className="flex h-full min-h-32 items-center justify-center bg-dark-950 px-6 text-sm text-dark-400"
		>
			Loading {label}…
		</div>
	);
}
