import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerUrl } from './server.ts';
import { VERSION } from '../../shared/version.ts';

// Regression: the player URL must carry ?m=&v= as a query string.
// A dropped "?" silently broke every open (empty location.search).

describe('buildPlayerUrl', () => {
  const ref = { title: 'Dune', kinopoisk: '535341', type: 'movie' } as const;

  it('joins base and query with ?', () => {
    const url = buildPlayerUrl('http://127.0.0.1:8080/', { ...ref }, VERSION);
    const escaped = VERSION.replace(/\./g, '\\.');
    assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:8080/\\?m=[A-Za-z0-9\\-_]+&v=${escaped}$`));
  });

  it('adds a missing trailing slash', () => {
    const url = buildPlayerUrl('http://127.0.0.1:8080', { ...ref }, VERSION);
    assert.ok(url.startsWith('http://127.0.0.1:8080/?m='));
  });

  it('throws on invalid ref', () => {
    assert.throws(() => buildPlayerUrl('http://127.0.0.1:8080/', { title: '' }, VERSION));
  });
});
