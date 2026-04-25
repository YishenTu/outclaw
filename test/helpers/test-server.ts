type TestServeOptions<T = undefined> = Parameters<typeof Bun.serve<T>>[0];

const TEST_PORT_MIN = 49152;
const TEST_PORT_RANGE = 16384;
let nextTestPort = TEST_PORT_MIN + Math.floor(Math.random() * TEST_PORT_RANGE);

export function createTestServer<T = undefined>(options: TestServeOptions<T>) {
	if (options.port !== 0 && options.port !== undefined) {
		return Bun.serve<T>(options);
	}

	let lastError: unknown;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			return Bun.serve<T>({
				...options,
				port: reserveTestPort(),
			} as TestServeOptions<T>);
		} catch (error) {
			if (!isListenError(error)) {
				throw error;
			}
			lastError = error;
		}
	}

	throw lastError;
}

function reserveTestPort(): number {
	const port = nextTestPort;
	nextTestPort += 1;
	if (nextTestPort >= TEST_PORT_MIN + TEST_PORT_RANGE) {
		nextTestPort = TEST_PORT_MIN;
	}
	return port;
}

function isListenError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "EADDRINUSE"
	);
}
