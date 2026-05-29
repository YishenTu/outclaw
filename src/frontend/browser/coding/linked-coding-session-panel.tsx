import { useEffect, useState } from "react";
import type {
	BrowserCodingRepositorySummary,
	BrowserCodingSessionSummary,
} from "../../../common/protocol.ts";
import { CenterPanelBreadcrumb } from "../components/center/center-panel-breadcrumb.tsx";
import { fetchCodingRepository, fetchCodingSession } from "../lib/api.ts";
import { ActiveSessionPanel } from "./coding-session-view.tsx";

interface LinkedCodingSessionPanelProps {
	providerId: string;
	sdkSessionId: string;
	repositoryId: string;
	title: string;
}

export function LinkedCodingSessionPanel({
	providerId,
	repositoryId,
	sdkSessionId,
	title,
}: LinkedCodingSessionPanelProps) {
	const [session, setSession] = useState<
		BrowserCodingSessionSummary | undefined
	>();
	const [repository, setRepository] = useState<
		BrowserCodingRepositorySummary | undefined
	>();
	const [error, setError] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setSession(undefined);
		setRepository(undefined);
		setError(undefined);

		async function load() {
			try {
				const nextSession = await fetchCodingSession(providerId, sdkSessionId);
				if (cancelled) {
					return;
				}
				setSession(nextSession);
				const nextRepository = await fetchCodingRepository(
					nextSession.repositoryId ?? repositoryId,
				);
				if (!cancelled) {
					setRepository(nextRepository);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		}

		void load();
		return () => {
			cancelled = true;
		};
	}, [providerId, repositoryId, sdkSessionId]);

	if (error) {
		return <LinkedCodingSessionShell title={title} message={error} />;
	}

	if (!session || !repository) {
		return (
			<LinkedCodingSessionShell
				title={title}
				message="Loading coding session..."
			/>
		);
	}

	return <ActiveSessionPanel repository={repository} session={session} />;
}

function LinkedCodingSessionShell({
	message,
	title,
}: {
	message: string;
	title: string;
}) {
	return (
		<div className="flex h-full flex-col bg-dark-950">
			<div className="h-8 shrink-0 border-b border-dark-800 px-6">
				<div className="flex h-full max-w-4xl items-center gap-4">
					<CenterPanelBreadcrumb leading="Code" title={title} />
				</div>
			</div>
			<div className="flex flex-1 items-center justify-center px-6">
				<div className="border border-dashed border-dark-800 px-6 py-5 text-center">
					<div className="font-mono-ui text-[12px] uppercase tracking-[0.18em] text-dark-500">
						Coding session
					</div>
					<div className="mt-3 max-w-md text-sm text-dark-400">{message}</div>
				</div>
			</div>
		</div>
	);
}
