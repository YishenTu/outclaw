class ExitError extends Error {
	constructor(readonly code: number) {
		super(`process.exit(${code})`);
	}
}

export async function captureExitOutput(fn: () => void | Promise<void>) {
	const logs: string[] = [];
	const errors: string[] = [];
	const originalLog = console.log;
	const originalError = console.error;
	const originalExit = process.exit;
	console.log = (...args: unknown[]) => logs.push(args.join(" "));
	console.error = (...args: unknown[]) => errors.push(args.join(" "));
	process.exit = ((code?: string | number | null | undefined) => {
		throw new ExitError(typeof code === "number" ? code : Number(code ?? 0));
	}) as typeof process.exit;
	try {
		await fn();
		return { code: undefined, errors, logs };
	} catch (error) {
		if (error instanceof ExitError) {
			return { code: error.code, errors, logs };
		}
		throw error;
	} finally {
		console.log = originalLog;
		console.error = originalError;
		process.exit = originalExit;
	}
}
