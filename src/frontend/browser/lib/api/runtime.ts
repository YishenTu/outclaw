import type {
	BrowserConfigResponse,
	BrowserImageUploadResponse,
	BrowserLatencyResponse,
} from "../../../../common/protocol.ts";
import { parseJsonResponse } from "../http-client.ts";

export async function fetchRuntimeLatency(
	signal?: AbortSignal,
): Promise<BrowserLatencyResponse> {
	return parseJsonResponse(
		await fetch("/api/latency", {
			cache: "no-store",
			signal,
		}),
	);
}

export async function fetchConfigFile(): Promise<BrowserConfigResponse> {
	return parseJsonResponse(await fetch("/api/config"));
}

export async function updateConfigFile(
	document: Record<string, unknown>,
): Promise<BrowserConfigResponse> {
	return parseJsonResponse(
		await fetch("/api/config", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ document }),
		}),
	);
}

export async function uploadPromptImages(
	files: File[],
): Promise<BrowserImageUploadResponse["images"]> {
	const formData = new FormData();
	for (const file of files) {
		formData.append("images", file);
	}
	const response = await parseJsonResponse<BrowserImageUploadResponse>(
		await fetch("/api/images", { method: "POST", body: formData }),
	);
	return response.images;
}
