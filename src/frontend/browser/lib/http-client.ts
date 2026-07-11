export type JsonValidator<T> = (value: unknown) => value is T;

export interface JsonRequestOptions extends RequestInit {
	fetcher?: typeof fetch;
	validate?: JsonValidator<unknown>;
}

export class HttpRequestError extends Error {
	readonly status: number;
	readonly payload: unknown;

	constructor(message: string, status: number, payload: unknown) {
		super(message);
		this.name = "HttpRequestError";
		this.status = status;
		this.payload = payload;
	}
}

export async function requestJson<T>(
	input: RequestInfo | URL,
	options: JsonRequestOptions = {},
): Promise<T> {
	const { fetcher = fetch, validate, ...init } = options;
	const response = await fetcher(input, init);
	return parseJsonResponse(response, validate as JsonValidator<T> | undefined);
}

export async function parseJsonResponse<T>(
	response: Response,
	validate?: JsonValidator<T>,
): Promise<T> {
	const payload = await readJsonPayload(response);

	if (!response.ok) {
		throw new HttpRequestError(
			readErrorMessage(payload) ?? `Request failed: ${response.status}`,
			response.status,
			payload,
		);
	}

	if (validate && !validate(payload)) {
		throw new HttpRequestError(
			"Invalid response payload",
			response.status,
			payload,
		);
	}

	return payload as T;
}

async function readJsonPayload(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new HttpRequestError(
			"Response was not valid JSON",
			response.status,
			undefined,
		);
	}
}

function readErrorMessage(payload: unknown): string | undefined {
	if (typeof payload !== "object" || payload === null) {
		return undefined;
	}
	const error = (payload as { error?: unknown }).error;
	return typeof error === "string" ? error : undefined;
}
