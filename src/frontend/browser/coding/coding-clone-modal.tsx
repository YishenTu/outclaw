import { GitBranch, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "../components/ui/dialog.tsx";

interface CodingCloneModalProps {
	defaultLocation?: string;
	onBrowseLocation(): Promise<string | undefined>;
	onClone(params: {
		remoteUrl: string;
		parentDir: string;
	}): Promise<{ ok: true } | { ok: false; message: string }>;
	onClose(): void;
}

export function CodingCloneModal({
	defaultLocation,
	onBrowseLocation,
	onClone,
	onClose,
}: CodingCloneModalProps) {
	const [remoteUrl, setRemoteUrl] = useState("");
	const [location, setLocation] = useState(defaultLocation ?? "");
	const [error, setError] = useState<string | undefined>();
	const [cloning, setCloning] = useState(false);
	const [browsing, setBrowsing] = useState(false);
	const urlInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		urlInputRef.current?.focus();
	}, []);

	const canSubmit =
		!cloning && !browsing && remoteUrl.trim() !== "" && location.trim() !== "";

	const handleBrowse = useCallback(async () => {
		if (cloning || browsing) {
			return;
		}
		setBrowsing(true);
		setError(undefined);
		try {
			const picked = await onBrowseLocation();
			if (picked) {
				setLocation(picked);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBrowsing(false);
		}
	}, [browsing, cloning, onBrowseLocation]);

	const handleClone = useCallback(async () => {
		if (!canSubmit) {
			return;
		}
		setCloning(true);
		setError(undefined);
		try {
			const result = await onClone({
				remoteUrl: remoteUrl.trim(),
				parentDir: location.trim(),
			});
			if (!result.ok) {
				setError(result.message);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCloning(false);
		}
	}, [canSubmit, location, onClone, remoteUrl]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				if (!cloning) {
					onClose();
				}
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key === "Enter" &&
				canSubmit
			) {
				event.preventDefault();
				void handleClone();
			}
		},
		[canSubmit, cloning, handleClone, onClose],
	);

	return (
		<Dialog
			ariaLabel="Clone GitHub repo"
			className="w-full max-w-xl overflow-hidden rounded-2xl border border-dark-800 bg-dark-950 shadow-2xl shadow-black/50"
			initialFocusRef={urlInputRef}
			onClose={onClose}
			onKeyDown={handleKeyDown}
			preventClose={cloning}
		>
			<div>
				<div className="flex items-center justify-between gap-3 bg-dark-900/40 px-5 py-4">
					<div className="flex items-center gap-2 text-dark-50">
						<GitBranch size={16} className="shrink-0 text-dark-300" />
						<div className="font-display text-[15px] font-semibold tracking-[0.01em]">
							Clone GitHub repo
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={cloning}
						aria-label="Close clone dialog"
						className="text-dark-500 transition-colors hover:text-dark-100 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<X size={16} />
					</button>
				</div>

				<div className="flex flex-col gap-4 px-5 py-5">
					<label className="flex flex-col gap-1.5">
						<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-300">
							Repository URL
						</span>
						<input
							ref={urlInputRef}
							type="text"
							value={remoteUrl}
							onChange={(event) => setRemoteUrl(event.target.value)}
							placeholder="https://github.com/user/repo.git"
							disabled={cloning}
							spellCheck={false}
							autoCapitalize="off"
							autoCorrect="off"
							className="rounded-md border border-dark-700 bg-dark-950 px-3 py-2 text-sm text-dark-50 placeholder-dark-600 focus:border-warning/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
						/>
					</label>

					<div className="flex flex-col gap-1.5">
						<span className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-dark-300">
							Location
						</span>
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={location}
								onChange={(event) => setLocation(event.target.value)}
								placeholder="/path/to/parent/folder"
								disabled={cloning}
								spellCheck={false}
								autoCapitalize="off"
								autoCorrect="off"
								className="min-w-0 flex-1 rounded-md border border-dark-700 bg-dark-950 px-3 py-2 text-sm text-dark-50 placeholder-dark-600 focus:border-dark-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
							/>
							<button
								type="button"
								onClick={handleBrowse}
								disabled={cloning || browsing}
								className="shrink-0 rounded-md border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-dark-200 transition-colors hover:border-dark-500 hover:text-dark-50 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{browsing ? "Picking…" : "Browse"}
							</button>
						</div>
					</div>

					{error && (
						<div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
							{error}
						</div>
					)}
				</div>

				<div className="flex items-center justify-end gap-2 bg-dark-900/40 px-5 py-3">
					<button
						type="button"
						onClick={onClose}
						disabled={cloning}
						className="rounded-lg border border-dark-700 bg-dark-950 px-3 py-1.5 text-sm text-dark-200 transition-colors hover:border-dark-500 hover:text-dark-50 disabled:cursor-not-allowed disabled:opacity-60"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleClone}
						disabled={!canSubmit}
						className="rounded-lg border border-dark-700 bg-dark-800 px-4 py-1.5 text-sm font-medium text-dark-50 transition-colors hover:border-dark-500 hover:bg-dark-700 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{cloning ? "Cloning…" : "Clone repo"}
					</button>
				</div>
			</div>
		</Dialog>
	);
}
