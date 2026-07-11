import {
	ChevronLeft,
	FileText,
	GitBranch,
	GitCommitHorizontal,
} from "lucide-react";
import { lazy, type ReactElement, Suspense, useEffect } from "react";
import { FeatureLoading } from "../components/ui/feature-loading.tsx";
import { fileNameFromPath } from "../lib/path-display.ts";
import {
	type MobileOverlayDoc,
	useMobileNavStore,
} from "../stores/mobile-nav.ts";

const HISTORY_STATE_KEY = "mobileOverlay";

const FileViewer = lazy(async () => {
	const module = await import("../components/document-viewers.tsx");
	return { default: module.FileViewer };
});
const GitCommitViewer = lazy(async () => {
	const module = await import("../components/document-viewers.tsx");
	return { default: module.GitCommitViewer };
});
const GitDiffViewer = lazy(async () => {
	const module = await import("../components/document-viewers.tsx");
	return { default: module.GitDiffViewer };
});

interface OverlayHeaderProps {
	doc: MobileOverlayDoc;
	onClose: () => void;
}

function OverlayHeader({ doc, onClose }: OverlayHeaderProps) {
	const { icon, title } = describeDoc(doc);
	return (
		<div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-dark-800 bg-dark-950 px-2">
			<button
				type="button"
				onClick={onClose}
				aria-label="Close preview"
				className="flex h-8 w-8 items-center justify-center rounded text-dark-300 transition-colors hover:bg-dark-800 hover:text-dark-50"
			>
				<ChevronLeft size={20} />
			</button>
			<span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-dark-100">
				{icon}
				<span className="min-w-0 truncate">{title}</span>
			</span>
		</div>
	);
}

function describeDoc(doc: MobileOverlayDoc): {
	icon: ReactElement;
	title: string;
} {
	if (doc.type === "file") {
		return {
			icon: <FileText size={14} className="shrink-0 text-dark-400" />,
			title: fileNameFromPath(doc.path),
		};
	}
	if (doc.type === "git-diff") {
		return {
			icon: <GitBranch size={14} className="shrink-0 text-dark-400" />,
			title: fileNameFromPath(doc.path),
		};
	}
	return {
		icon: <GitCommitHorizontal size={14} className="shrink-0 text-dark-400" />,
		title: doc.title,
	};
}

function OverlayBody({ doc }: { doc: MobileOverlayDoc }) {
	if (doc.type === "file") {
		return (
			<FileViewer
				active
				tabId={doc.id}
				path={doc.path}
				source={{ kind: "agent", agentId: doc.agentId }}
			/>
		);
	}
	if (doc.type === "git-diff") {
		return <GitDiffViewer path={doc.path} />;
	}
	return <GitCommitViewer sha={doc.sha} title={doc.title} />;
}

export function MobileOverlay() {
	const overlayDoc = useMobileNavStore((state) => state.overlayDoc);
	const closeOverlay = useMobileNavStore((state) => state.closeOverlay);

	// Hardware/browser back closes the overlay instead of leaving the page.
	useEffect(() => {
		if (!overlayDoc) {
			return;
		}
		if (typeof window === "undefined") {
			return;
		}
		window.history.pushState({ [HISTORY_STATE_KEY]: true }, "");
		const handlePopState = () => {
			closeOverlay();
		};
		window.addEventListener("popstate", handlePopState);
		return () => {
			window.removeEventListener("popstate", handlePopState);
			// If the overlay is closing while our entry is still on top of the
			// stack, pop it so the history entry doesn't linger.
			if (window.history.state?.[HISTORY_STATE_KEY]) {
				window.history.back();
			}
		};
	}, [overlayDoc, closeOverlay]);

	if (!overlayDoc) {
		return null;
	}

	return (
		<div className="absolute inset-0 z-30 flex flex-col bg-dark-950">
			<OverlayHeader doc={overlayDoc} onClose={closeOverlay} />
			<div className="min-h-0 flex-1 overflow-hidden">
				<Suspense fallback={<FeatureLoading label="preview" />}>
					<OverlayBody doc={overlayDoc} />
				</Suspense>
			</div>
		</div>
	);
}
