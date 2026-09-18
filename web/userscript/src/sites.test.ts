import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { siteFor } from './sites.ts';

describe('siteFor', () => {
	it('matches the hosts the userscript is injected on', () => {
		assert.equal(siteFor('www.kinopoisk.ru', '/film/4094466/'), 'kinopoisk');
		assert.equal(siteFor('hd.kinopoisk.ru', '/'), 'kinopoisk');
		assert.equal(siteFor('www.imdb.com', '/title/tt0111161/'), 'imdb');
		assert.equal(siteFor('m.imdb.com', '/title/tt0111161/'), 'imdb');
		assert.equal(siteFor('www.themoviedb.org', '/movie/438631'), 'tmdb');
		assert.equal(siteFor('www.themoviedb.org', '/tv/1399'), 'tmdb');
		assert.equal(siteFor('letterboxd.com', '/film/dune-2021/'), 'letterboxd');
	});

	it('requires a matching path for the id-based sites', () => {
		assert.equal(siteFor('www.imdb.com', '/search/?q=dune'), null);
		assert.equal(siteFor('www.themoviedb.org', '/person/1'), null);
		assert.equal(siteFor('letterboxd.com', '/dune-2021/'), null);
	});

	it('rejects lookalike hosts', () => {
		assert.equal(siteFor('notkinopoisk.ru', '/film/1/'), null);
		assert.equal(siteFor('imdb.com.evil.example', '/title/tt1/'), null);
		assert.equal(siteFor('fakethemoviedb.org', '/movie/1'), null);
		assert.equal(siteFor('letterboxd.com.evil.example', '/film/x/'), null);
	});
});
