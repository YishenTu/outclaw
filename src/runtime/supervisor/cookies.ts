/**
 * Browser-client cookie helpers.
 *
 * The cookie is purely a routing hint: it remembers which agent a given browser
 * last picked, so subsequent visits auto-bind to the same one without a picker.
 * It is NOT an authentication token. The trust boundary is the network layer
 * (Tailscale + WireGuard); anyone reaching the daemon is already trusted, and
 * presenting any cookie value gets routed accordingly.
 */

const COOKIE_NAME = "oc_client_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function parseClientIdCookie(req: Request): string | undefined {
	const header = req.headers.get("cookie");
	if (!header) {
		return undefined;
	}

	for (const part of header.split(";")) {
		const trimmed = part.trim();
		const eq = trimmed.indexOf("=");
		if (eq === -1) {
			continue;
		}
		if (trimmed.slice(0, eq) === COOKIE_NAME) {
			const value = trimmed.slice(eq + 1);
			return value.length > 0 ? value : undefined;
		}
	}
	return undefined;
}

export function generateClientId(): string {
	return crypto.randomUUID();
}

export function buildClientIdCookieHeader(clientId: string): string {
	return `${COOKIE_NAME}=${clientId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}`;
}
