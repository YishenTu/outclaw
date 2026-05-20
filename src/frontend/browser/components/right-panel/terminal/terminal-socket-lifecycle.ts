export interface TerminalSocketLike {
	close: () => void;
	send: (data: string) => void;
}

interface TerminalSocketHandlers {
	onclose: ((event?: unknown) => void) | null;
	onerror: ((event?: unknown) => void) | null;
	onmessage: ((message: { data: unknown }) => void) | null;
	onopen: ((event?: unknown) => void) | null;
}

export interface TerminalSocketLifecycleOptions<
	SocketLike extends TerminalSocketLike,
	TimerHandle = ReturnType<typeof setTimeout>,
> {
	clearRetry?: (timer: TimerHandle) => void;
	isSocketOpen: (socket: SocketLike) => boolean;
	onConnected: () => void;
	onData: (data: string) => void;
	onDisconnected: () => void;
	onError?: () => void;
	openSocket: () => SocketLike;
	retryDelayMs?: number;
	scheduleRetry?: (callback: () => void, delayMs: number) => TimerHandle;
	setCurrentSocket: (socket: SocketLike | null) => void;
}

export interface TerminalSocketLifecycle<
	SocketLike extends TerminalSocketLike,
> {
	getSocket: () => SocketLike | null;
	send: (data: string) => boolean;
	start: () => void;
	stop: () => void;
}

export function createTerminalSocketLifecycle<
	SocketLike extends TerminalSocketLike,
	TimerHandle = ReturnType<typeof setTimeout>,
>({
	clearRetry = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
	isSocketOpen,
	onConnected,
	onData,
	onDisconnected,
	onError,
	openSocket,
	retryDelayMs = 3000,
	scheduleRetry = (callback, delayMs) =>
		setTimeout(callback, delayMs) as TimerHandle,
	setCurrentSocket,
}: TerminalSocketLifecycleOptions<
	SocketLike,
	TimerHandle
>): TerminalSocketLifecycle<SocketLike> {
	let cancelled = false;
	let currentSocket: SocketLike | null = null;
	let retryTimer: TimerHandle | null = null;

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
		const handlers = socket as unknown as TerminalSocketHandlers;
		setSocket(socket);

		handlers.onopen = () => {
			if (cancelled || currentSocket !== socket) {
				return;
			}
			onConnected();
		};

		handlers.onmessage = (message) => {
			if (cancelled || currentSocket !== socket) {
				return;
			}
			onData(String(message.data));
		};

		handlers.onerror = () => {
			if (cancelled || currentSocket !== socket) {
				return;
			}
			onError?.();
		};

		handlers.onclose = () => {
			if (cancelled || currentSocket !== socket) {
				return;
			}
			setSocket(null);
			onDisconnected();
			retryTimer = scheduleRetry(connect, retryDelayMs);
		};
	}

	return {
		getSocket: () => currentSocket,
		send: (data) => {
			const socket = currentSocket;
			if (!socket || !isSocketOpen(socket)) {
				return false;
			}

			try {
				socket.send(data);
				return true;
			} catch {
				return false;
			}
		},
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
