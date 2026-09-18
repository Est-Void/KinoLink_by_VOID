import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildPlayerQuery,
	decodeMovieRef,
	encodeMovieRef,
	parseMovieRef,
	parsePlayerQuery,
} from './movie.ts';

describe('parseMovieRef', () => {
	it('accepts a full ref and strips unknown keys', () => {
		assert.deepEqual(
			parseMovieRef({ title: '  Дюна  ', kinopoisk: '123', junk: 1, type: 'series' }),
			{ title: 'Дюна', kinopoisk: '123', type: 'series' },
		);
	});

	it('defaults type to movie', () => {
		assert.equal(parseMovieRef({ title: 'A', imdb: 'tt0111161' })?.type, 'movie');
	});

	it('rejects empty title, bad ids and id-less refs', () => {
		assert.equal(parseMovieRef({ title: '   ', kinopoisk: '1' }), null);
		assert.equal(parseMovieRef({ title: 'A', kinopoisk: 'abc' }), null);
		assert.equal(parseMovieRef({ title: 'A', imdb: 'tt' }), null);
		assert.equal(parseMovieRef({ title: 'A' }), null);
		assert.equal(parseMovieRef(null), null);
		assert.equal(parseMovieRef('x'), null);
	});

	it('keeps valid details and drops bad ones', () => {
		assert.deepEqual(
			parseMovieRef({
				title: 'A',
				kinopoisk: '1',
				cover: 'https://example.com/a.jpg',
				year: '2021',
				genre: 'фантастика, драма',
			}),
			{
				title: 'A',
				type: 'movie',
				kinopoisk: '1',
				cover: 'https://example.com/a.jpg',
				year: '2021',
				genre: 'фантастика, драма',
			},
		);
		assert.deepEqual(parseMovieRef({ title: 'A', kinopoisk: '1', cover: 'javascript:1', year: '21', genre: '' }), {
			title: 'A',
			type: 'movie',
			kinopoisk: '1',
		});
	});
});

describe('encode/decode round-trip', () => {
	it('survives cyrillic, emoji and quotes', () => {
		const ref = { title: '«Дюна»: часть 2 🪱', kinopoisk: '535341', type: 'movie' } as const;
		const encoded = encodeMovieRef({ ...ref });
		assert.match(encoded, /^[A-Za-z0-9\-_]+$/);
		assert.deepEqual(decodeMovieRef(encoded), { ...ref });
	});

	it('returns null on corruption, never throws', () => {
		for (const bad of ['', '!!!', 'eyJ0aXRsZS', 'bm90LWpzb24=']) {
			assert.equal(decodeMovieRef(bad), null);
		}
	});
});

// Pins the example published in contract.md to the implementation, so the
// docs cannot drift away from the codec.
describe('contract example', () => {
	const EXAMPLE = 'eyJ0aXRsZSI6ItCU0Y7QvdCwIiwidHlwZSI6Im1vdmllIiwia2lub3BvaXNrIjoiNDA5NDQ2NiJ9';

	it('stays decodable', () => {
		assert.deepEqual(decodeMovieRef(EXAMPLE), {
			title: 'Дюна',
			type: 'movie',
			kinopoisk: '4094466',
		});
	});

	it('stays byte-identical to encodeMovieRef', () => {
		assert.equal(encodeMovieRef({ title: 'Дюна', kinopoisk: '4094466', type: 'movie' }), EXAMPLE);
	});
});

describe('player query', () => {
	it('builds and parses ?m=&v=', () => {
		const q = buildPlayerQuery({ title: 'Dune', tmdb: '438631' }, '2.0.0');
		const parsed = parsePlayerQuery(q);
		assert.deepEqual(parsed.movie, { title: 'Dune', tmdb: '438631', type: 'movie' });
		assert.equal(parsed.scriptVersion, '2.0.0');
	});

	it('missing m yields null movie', () => {
		assert.equal(parsePlayerQuery('?v=1.0.0').movie, null);
	});
});
