interface ControlRequestOptions<TResponse> {
	closeBeforeResponseMessage: string;
	errorFallback: string;
	errorType: string;
	port: number;
	request: unknown;
	responseType: string;
	timeout?: {
		message: string;
		ms: number;
	};
	toResult: (message: Record<string, unknown>) => TResponse;
}

export async function requestControlMessage<TResponse>(
	options: ControlRequestOptions<TResponse>,
): Promise<TResponse> {
	const ws = new WebSocket(`ws://localhost:${options.port}/?client=control`);

	return new Promise<TResponse>((resolve, reject) => {
		let settled = false;
		let opened = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		const finish = (fn: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
			}
			fn();
		};

		if (options.timeout !== undefined) {
			timeoutHandle = setTimeout(() => {
				finish(() => reject(new Error(`TIMEOUT:${options.timeout?.message}`)));
				ws.close();
			}, options.timeout.ms);
		}

		ws.addEventListener("open", () => {
			opened = true;
			ws.send(JSON.stringify(options.request));
		});

		ws.addEventListener("message", (event) => {
			const data = JSON.parse(String(event.data)) as Record<string, unknown>;
			if (data.type === options.responseType) {
				finish(() => resolve(options.toResult(data)));
				ws.close();
				return;
			}
			if (data.type === options.errorType) {
				finish(() =>
					reject(
						new Error(
							typeof data.message === "string"
								? data.message
								: options.errorFallback,
						),
					),
				);
				ws.close();
			}
		});

		ws.addEventListener("error", () => {
			finish(() => reject(new Error("daemon not running")));
		});

		ws.addEventListener("close", () => {
			if (settled) {
				return;
			}
			finish(() =>
				reject(
					new Error(
						opened ? options.closeBeforeResponseMessage : "daemon not running",
					),
				),
			);
		});
	});
}
