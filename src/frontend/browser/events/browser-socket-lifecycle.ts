import type { ServerEvent } from "../../../common/protocol.ts";

export type BrowserConnectionStatus =
	| "connecting"
	| "connected"
	| "disconnected";

export interface BrowserSocketLike {
	close: () => void;
}

interface BrowserSocketHandlers {
	onclose: ((event?: unknown) => void) | null;
	onerror: ((event?: unknown) => void) | null;
	onmessage: ((message: { data: unknown }) => void) | null;
	onopen: ((event?: unknown) => void) | null;
}

export interface BrowserRuntimeSocket<SocketLike extends BrowserSocketLike> {
	ready: Promise<void>;
	ws: SocketLike;
}

export interface BrowserSocketLifecycleOptions<
	SocketLike extends BrowserSocketLike,
	TimerHandle = ReturnType<typeof setTimeout>,
> {
	applyEvent: (event: ServerEvent) => void;
	clearRetry?: (timer: TimerHandle) => void;
	openSocket: () => BrowserRuntimeSocket<SocketLike>;
	onConnected: () => void;
	maxRetryDelayMs?: number;
	parseMessage: (data: string) => ServerEvent;
	retryDelayMs?: number;
	scheduleRetry?: (callback: () => void, delayMs: number) => TimerHandle;
	setConnectionStatus: (status: BrowserConnectionStatus) => void;
	setCurrentSocket: (socket: SocketLike | null) => void;
	setRuntimeError: (error: string | null) => void;
}

export interface BrowserSocketLifecycle<SocketLike extends BrowserSocketLike> {
	getSocket: () => SocketLike | null;
	start: () => void;
	stop: () => void;
}

export function createBrowserSocketLifecycle<
	SocketLike extends BrowserSocketLike,
	TimerHandle = ReturnType<typeof setTimeout>,
>({
	applyEvent,
	clearRetry = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
	openSocket,
	onConnected,
	maxRetryDelayMs = 30_000,
	parseMessage,
	retryDelayMs = 3000,
	scheduleRetry = (callback, delayMs) =>
		setTimeout(callback, delayMs) as TimerHandle,
	setConnectionStatus,
	setCurrentSocket,
	setRuntimeError,
}: BrowserSocketLifecycleOptions<
	SocketLike,
	TimerHandle
>): BrowserSocketLifecycle<SocketLike> {
	let cancelled = false;
	let currentSocket: SocketLike | null = null;
	let retryTimer: TimerHandle | null = null;
	let retryAttempt = 0;

	function setSocket(socket: SocketLike | null) {
		currentSocket = socket;
		setCurrentSocket(socket);
	}

	function clearRetryTimer() {
		if (retryTimer === null) {
			return;
		}
		clearRetry(retryTimer);
		retryTimer = null;
	}

	function connect() {
		if (cancelled) {
			return;
		}

		clearRetryTimer();
		const socket = openSocket();
		const ws = socket.ws;
		const handlers = ws as unknown as BrowserSocketHandlers;
		setSocket(ws);
		setConnectionStatus("connecting");
		void socket.ready.catch(() => {
			// onclose owns reconnect scheduling.
		});

		handlers.onopen = () => {
			if (cancelled || currentSocket !== ws) {
				return;
			}
			setConnectionStatus("connected");
			setRuntimeError(null);
			retryAttempt = 0;
			onConnected();
		};

		handlers.onclose = () => {
			if (cancelled || currentSocket !== ws) {
				return;
			}
			setSocket(null);
			setConnectionStatus("disconnected");
			const delayMs = Math.min(
				retryDelayMs * 2 ** retryAttempt,
				maxRetryDelayMs,
			);
			retryAttempt += 1;
			retryTimer = scheduleRetry(connect, delayMs);
		};

		handlers.onerror = () => {
			// close follows and schedules reconnect.
		};

		handlers.onmessage = (message) => {
			if (cancelled || currentSocket !== ws) {
				return;
			}
			try {
				applyEvent(parseMessage(String(message.data)));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setRuntimeError(`Invalid runtime message: ${message}`);
			}
		};
	}

	return {
		getSocket: () => currentSocket,
		start: connect,
		stop: () => {
			cancelled = true;
			clearRetryTimer();
			const socket = currentSocket;
			setSocket(null);
			socket?.close();
		},
	};
}
