import { AlertCircle, X } from "lucide-react";
import type { FrontendNotice } from "../../../common/protocol.ts";
import { projectRuntimeNotice } from "../runtime-notice-projection.ts";
import {
	selectVisibleRuntimeNotice,
	useRuntimeStore,
} from "../stores/runtime.ts";

interface BrowserRestartNoticeContentProps {
	notice: FrontendNotice | null;
	onDismiss?: () => void;
}

export function BrowserRestartNoticeContent({
	notice,
	onDismiss,
}: BrowserRestartNoticeContentProps) {
	const projection = projectRuntimeNotice(notice);
	if (!projection) {
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
				<div className="min-w-0 flex-1">
					<div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] text-warning">
						{projection.title}
					</div>
					<div className="mt-1 text-sm leading-6 text-warning/80">
						{projection.detail}
					</div>
				</div>
				{projection.dismissible && onDismiss ? (
					<button
						type="button"
						onClick={onDismiss}
						aria-label="Dismiss notification"
						className="shrink-0 text-warning/70 transition-colors hover:text-warning"
					>
						<X size={14} />
					</button>
				) : null}
			</div>
		</div>
	);
}

export function BrowserRestartNotice() {
	const notice = useRuntimeStore(selectVisibleRuntimeNotice);
	const dismissNotice = useRuntimeStore((state) => state.dismissNotice);
	return (
		<BrowserRestartNoticeContent
			notice={notice}
			onDismiss={
				projectRuntimeNotice(notice)?.dismissible ? dismissNotice : undefined
			}
		/>
	);
}
