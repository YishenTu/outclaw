import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import { useRuntimeStore } from "../../stores/runtime.ts";

function formatRemaining(targetTime: number, now: number): string {
	const remainingMs = Math.max(0, targetTime - now);
	const totalSeconds = Math.ceil(remainingMs / 1000);

	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const totalMinutes = Math.ceil(totalSeconds / 60);
	if (totalMinutes < 60) {
		return `${totalMinutes}m`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function HeartbeatIndicator() {
	const nextHeartbeatAt = useRuntimeStore((state) => state.nextHeartbeatAt);
	const heartbeatDeferred = useRuntimeStore((state) => state.heartbeatDeferred);
	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		if (!nextHeartbeatAt && !heartbeatDeferred) {
			return;
		}

		setNow(Date.now());
		const intervalId = window.setInterval(() => {
			setNow(Date.now());
		}, 1000);

		return () => {
			window.clearInterval(intervalId);
		};
	}, [nextHeartbeatAt, heartbeatDeferred]);

	if (heartbeatDeferred) {
		return (
			<div className="ml-1 flex shrink-0 items-center gap-1">
				<Heart size={13} className="text-pink-300" strokeWidth={1.8} />
				<span className="text-xs text-dark-400">Deferred</span>
			</div>
		);
	}

	if (!nextHeartbeatAt) {
		return null;
	}

	return (
		<div className="ml-1 flex shrink-0 items-center gap-1">
			<Heart size={13} className="text-pink-300" strokeWidth={1.8} />
			<span className="text-xs text-dark-400">
				{formatRemaining(nextHeartbeatAt, now)}
			</span>
		</div>
	);
}
