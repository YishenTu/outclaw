import { AlertCircle } from "lucide-react";
import type { FrontendNotice } from "../../../common/protocol.ts";
import { useRuntimeStore } from "../stores/runtime.ts";

interface BrowserRestartNoticeContentProps {
	notice: FrontendNotice | null;
}

export function BrowserRestartNoticeContent({
	notice,
}: BrowserRestartNoticeContentProps) {
	if (notice?.kind !== "restart_required") {
		return null;
	}

	return (
		<div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3">
			<div className="mx-auto flex max-w-5xl items-start gap-3">
				<AlertCircle
					size={16}
					className="mt-0.5 shrink-0 text-amber-300"
					aria-hidden="true"
				/>
				<div className="min-w-0">
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-amber-200">
						Restart required
					</div>
					<div className="mt-1 text-sm leading-6 text-amber-100/80">
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
