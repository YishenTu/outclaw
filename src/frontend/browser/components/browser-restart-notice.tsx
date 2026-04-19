import { AlertCircle } from "lucide-react";
import type { FrontendNotice } from "../../../common/protocol.ts";
import { useRuntimeStore } from "../stores/runtime.ts";

interface BrowserRestartNoticeContentProps {
	notice: FrontendNotice | null;
}

export function BrowserRestartNoticeContent({
	notice,
}: BrowserRestartNoticeContentProps) {
	if (!notice) {
		return null;
	}

	if (notice.kind === "rollover") {
		return (
			<div className="border-b border-warning/30 bg-warning/10 px-6 py-3">
				<div className="mx-auto flex max-w-4xl items-start gap-3">
					<AlertCircle
						size={16}
						className="mt-0.5 shrink-0 text-warning"
						aria-hidden="true"
					/>
					<div className="min-w-0">
						<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-warning">
							Session rollover
						</div>
						<div className="mt-1 text-sm leading-6 text-warning/80">
							{notice.message}
						</div>
					</div>
				</div>
			</div>
		);
	}

	if (notice.kind !== "restart_required") {
		return null;
	}

	return (
		<div className="border-b border-warning/30 bg-warning/10 px-6 py-3">
			<div className="mx-auto flex max-w-4xl items-start gap-3">
				<AlertCircle
					size={16}
					className="mt-0.5 shrink-0 text-warning"
					aria-hidden="true"
				/>
				<div className="min-w-0">
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-warning">
						Restart required
					</div>
					<div className="mt-1 text-sm leading-6 text-warning/80">
						Changes won&apos;t update until the runtime restarts.
					</div>
				</div>
			</div>
		</div>
	);
}

export function BrowserRestartNotice() {
	const notice = useRuntimeStore((state) => state.notice);
	return <BrowserRestartNoticeContent notice={notice} />;
}
