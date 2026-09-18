// Player opening. No server discovery: the end user installs only the
// script, so it always opens the hosted player. One constant, no prompts,
// no port scanning — user friendly by design.
//
// Local dev override (never shown to users): run once in the console on any
// of the movie sites:
//   localStorage.setItem('kinolink-player-url', 'http://127.0.0.1:8080/')

import { buildPlayerQuery, parseMovieRef } from '../../shared/movie';
import { VERSION } from '../../shared/version';
import type { RawRef } from './sites';
import { logger } from './log';

// TODO: production player URL (docker hosting). Must end with a slash.
const PLAYER_URL = 'https://example.com/';
const PLAYER_OVERRIDE_KEY = 'kinolink-player-url';

function playerBase(): string {
  try {
    const override = localStorage.getItem(PLAYER_OVERRIDE_KEY);
    if (override) return override.endsWith('/') ? override : `${override}/`;
  } catch { /* ignore */ }
  return PLAYER_URL;
}

export function openPlayer(raw: RawRef): void {
  const movie = parseMovieRef(raw);
  if (!movie) {
    logger.error('refused to open player: invalid movie ref', raw);
    return;
  }
  // Synchronous window.open inside the click handler keeps the user gesture
  // (mobile popup blockers stay happy).
  const url = playerBase() + buildPlayerQuery(movie, VERSION).slice(1);
  logger.info('opening player', url);
  if (!window.open(url, '_blank')) window.location.assign(url);
}
