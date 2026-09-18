import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coverSrc } from './cover.ts';

const ORIGIN = 'http://127.0.0.1:8080';

describe('coverSrc', () => {
	it('proxies cross-origin posters through the server', () => {
		assert.equal(
			coverSrc('https://image.tmdb.org/t/p/w500/x.jpg', ORIGIN),
			`/api/cover?url=${encodeURIComponent('https://image.tmdb.org/t/p/w500/x.jpg')}`,
		);
	});

	it('leaves same-origin covers untouched', () => {
		assert.equal(coverSrc(`${ORIGIN}/assets/x.jpg`, ORIGIN), `${ORIGIN}/assets/x.jpg`);
	});

	it('resolves protocol-relative and relative URLs', () => {
		assert.equal(
			coverSrc('//image.tmdb.org/a.jpg', 'https://player.test'),
			`/api/cover?url=${encodeURIComponent('https://image.tmdb.org/a.jpg')}`,
		);
		assert.equal(
			coverSrc('/local.jpg', ORIGIN),
			`${ORIGIN}/local.jpg`,
		);
	});

	it('rejects empty and non-http values', () => {
		assert.equal(coverSrc('', ORIGIN), '');
		assert.equal(coverSrc('javascript:alert(1)', ORIGIN), '');
		assert.equal(coverSrc('data:image/png;base64,AAAA', ORIGIN), '');
	});
});
