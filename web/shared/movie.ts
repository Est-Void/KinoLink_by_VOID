// KinoLink v2 shared contract: MovieRef encode/decode/validate.
// Zero dependencies — imported by both the userscript and the player.
// Keep in sync with web/shared/contract.md. Only erasable TS syntax
// (interfaces + type annotations) so Node can run it without a build step.

export interface MovieRef {
	title: string;
	kinopoisk?: string;
	imdb?: string;
	tmdb?: string;
	type?: 'movie' | 'series';
	cover?: string;
	year?: string;
	genre?: string;
}

const TITLE_MAX = 300;
const DETAIL_MAX = 200;
// Kinopoisk serves some posters as long signed CDN URLs (~3 KB). Keep generous
// headroom; never truncate — a cut URL is a guaranteed 404.
const COVER_MAX = 8192;
const KINOPOISK_RE = /^\d{1,20}$/;
const IMDB_RE = /^tt\d{1,20}$/;
const TMDB_RE = /^\d{1,20}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** Validate unknown input, strip unknown keys, apply defaults. Null on invalid. */
export function parseMovieRef(input: unknown): MovieRef | null {
	if (!isRecord(input)) return null;

	const title = cleanString(input.title).slice(0, TITLE_MAX);
	if (!title) return null;

	const out: MovieRef = { title, type: 'movie' };

	const kinopoisk = cleanString(input.kinopoisk);
	if (kinopoisk) {
		if (!KINOPOISK_RE.test(kinopoisk)) return null;
		out.kinopoisk = kinopoisk;
	}
	const imdb = cleanString(input.imdb);
	if (imdb) {
		if (!IMDB_RE.test(imdb)) return null;
		out.imdb = imdb;
	}
	const tmdb = cleanString(input.tmdb);
	if (tmdb) {
		if (!TMDB_RE.test(tmdb)) return null;
		out.tmdb = tmdb;
	}
	if (!out.kinopoisk && !out.imdb && !out.tmdb) return null;

	if (input.type === 'series' || input.type === 'movie') out.type = input.type;

	const cover = cleanString(input.cover);
	// Drop an oversized URL instead of truncating it into a broken link.
	if (cover && cover.length <= COVER_MAX && (cover.startsWith('http://') || cover.startsWith('https://'))) {
		out.cover = cover;
	}
	const year = cleanString(input.year);
	if (/^\d{4}$/.test(year)) out.year = year;
	const genre = cleanString(input.genre).slice(0, DETAIL_MAX);
	if (genre) out.genre = genre;

	return out;
}

function bytesToB64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(data: string): Uint8Array {
	if (!/^[A-Za-z0-9\-_]*$/.test(data) || data === '') {
		throw new Error('bad base64url');
	}
	const padded = data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** MovieRef -> base64url(UTF-8(JSON)), no padding. Throws on invalid input. */
export function encodeMovieRef(ref: MovieRef): string {
	const valid = parseMovieRef(ref);
	if (!valid) throw new Error('invalid MovieRef');
	return bytesToB64Url(encoder.encode(JSON.stringify(valid)));
}

/** base64url -> MovieRef. Null on any corruption (never throws). */
export function decodeMovieRef(data: string): MovieRef | null {
	try {
		return parseMovieRef(JSON.parse(decoder.decode(b64UrlToBytes(data))));
	} catch {
		return null;
	}
}

/** Build the player query string: ?m=<...>&v=<...>. Throws on invalid ref. */
export function buildPlayerQuery(ref: MovieRef, scriptVersion: string): string {
	const params = new URLSearchParams();
	params.set('m', encodeMovieRef(ref));
	if (scriptVersion) params.set('v', scriptVersion);
	return `?${params.toString()}`;
}

/** Parse location.search of the player page. */
export function parsePlayerQuery(search: string): { movie: MovieRef | null; scriptVersion: string } {
	const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
	return {
		movie: decodeMovieRef(params.get('m') ?? ''),
		scriptVersion: params.get('v') ?? '',
	};
}
