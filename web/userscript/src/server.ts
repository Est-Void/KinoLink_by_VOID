// Player opening. No server discovery: the end user installs only the
// script, so it always opens the hosted player. One constant, no prompts,
// no port scanning — user friendly by design.
//
// Dev branch default is the local server so the button works out of the box.
// TODO(release): flip to the production player URL (docker hosting).
// Temporary override for any base URL (never shown to users), set once in
// the console on any of the movie sites:
//   localStorage.setItem('kinolink-player-url', 'http://192.168.1.5:8080/')

import { buildPlayerQuery, parseMovieRef } from '../../shared/movie.ts';
import { VERSION } from '../../shared/version.ts';
import type { RawRef } from './sites.ts';
import { logger } from './log.ts';

const PLAYER_URL = 'http://127.0.0.1:8080/';
const PLAYER_OVERRIDE_KEY = 'kinolink-player-url';

function playerBase(): string {
  try {
    const override = localStorage.getItem(PLAYER_OVERRIDE_KEY);
    if (override) return override.endsWith('/') ? override : `${override}/`;
  } catch { /* ignore */ }
  return PLAYER_URL;
}

export function openPlayer(raw: RawRef): void {
  let url: string;
  try {
    url = buildPlayerUrl(playerBase(), raw, VERSION);
  } catch (error) {
    logger.error('refused to open player: invalid movie ref', raw, error);
    return;
  }
  // Synchronous window.open inside the click handler keeps the user gesture
  // (mobile popup blockers stay happy).
  logger.info('opening player', url);
  if (!window.open(url, '_blank')) window.location.assign(url);
}

/** Join base URL with the player query. Throws on invalid ref. */
export function buildPlayerUrl(base: string, raw: RawRef, scriptVersion: string): string {
  const movie = parseMovieRef(raw);
  if (!movie) throw new Error('invalid MovieRef');
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return normalized + buildPlayerQuery(movie, scriptVersion);
}
