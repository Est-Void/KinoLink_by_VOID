// Cover rendering helper. Cross-origin posters are routed through our own
// server (/api/cover, see server/cover.go) so the browser never hotlinks the
// source CDN — this dodges referer/hotlink blocks and keeps the player
// same-origin. Same-origin covers are used as-is.

const COVER_ENDPOINT = '/api/cover';

/** Absolute src for a poster: same-origin as-is, cross-origin via the proxy. */
export function coverSrc(raw: string, pageOrigin: string): string {
	if (!raw) return '';
	try {
		const url = new URL(raw, pageOrigin);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
		if (url.origin === pageOrigin) return url.href;
		return `${COVER_ENDPOINT}?url=${encodeURIComponent(url.href)}`;
	} catch {
		return '';
	}
}
