export interface SidebarRefreshGate {
	invalidate(): void;
	isCurrent(requestId: number): boolean;
	startRequest(): number;
}

export function createSidebarRefreshGate(): SidebarRefreshGate {
	let currentRequestId = 0;

	return {
		invalidate() {
			currentRequestId += 1;
		},
		isCurrent(requestId) {
			return requestId === currentRequestId;
		},
		startRequest() {
			currentRequestId += 1;
			return currentRequestId;
		},
	};
}
