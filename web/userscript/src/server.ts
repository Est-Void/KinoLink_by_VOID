// Server discovery + player opening. Runs inside the click handler so
// window.open keeps the user gesture (mobile popup blockers) and the
// LAN prompt does not break it either (prompt blocks the same task).

import { buildPlayerQuery, parseMovieRef } from '../../shared/movie';
import { VERSION } from '../../shared/version';
import type { RawRef } from './sites';
import { logger } from './log';

const CUSTOM_SERVER_URL = '';
const SERVER_KEY = 'kinolink-server-url';
const LOCAL_SENTINEL = '__kinolink-local__';
const PORT_START = 8080;
const PORT_END = 8129;
const PROBE_TIMEOUT = 700;

function gmGet(key: string): string {
  try {
    if (typeof GM_getValue === 'function') return GM_getValue(key, '');
  } catch { /* fall through to localStorage */ }
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function gmSet(key: string, value: string): void {
  try {
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
  } catch { /* ignore */ }
  try {
    localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function requestJson(url: string): Promise<{ ok: boolean; data: unknown }> {
  if (typeof GM_xmlhttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: PROBE_TIMEOUT,
        onload: (res) => {
          try {
            resolve({ ok: res.status >= 200 && res.status < 300, data: JSON.parse(res.responseText || '{}') });
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
  return fetch(url, { signal: ctrl.signal })
    .then(async (res) => ({ ok: res.ok, data: await res.json() }))
    .finally(() => clearTimeout(timer));
}

async function probe(base: string): Promise<boolean> {
  try {
    const res = await requestJson(`${base}api/status`);
    return Boolean(res.ok && (res.data as { app?: string })?.app === 'kinolink');
  } catch {
    return false;
  }
}

async function scanLocal(parallelism = 8): Promise<string> {
  const ports: number[] = [];
  for (let p = PORT_START; p <= PORT_END; p++) ports.push(p);
  for (let i = 0; i < ports.length; i += parallelism) {
    const batch = ports.slice(i, i + parallelism);
    const found = await Promise.all(
      batch.map(async (p) => {
        const base = `http://127.0.0.1:${p}/`;
        return (await probe(base)) ? base : '';
      }),
    ).then((results) => results.find(Boolean) ?? '');
    if (found) return found;
  }
  return '';
}

export async function openPlayer(raw: RawRef): Promise<void> {
  const movie = parseMovieRef(raw);
  if (!movie) {
    logger.error('refused to open player: invalid movie ref', raw);
    return;
  }

  const custom = normalizeUrl(CUSTOM_SERVER_URL);
  if (custom) {
    window.open(custom + buildPlayerQuery(movie, VERSION).slice(1), '_blank');
    return;
  }

  const stored = gmGet(SERVER_KEY);
  if (stored && stored !== LOCAL_SENTINEL) {
    const base = normalizeUrl(stored);
    if (base && (await probe(base))) {
      window.open(base + buildPlayerQuery(movie, VERSION).slice(1), '_blank');
      return;
    }
  }

  let base = '';
  if (!stored) {
    const answer = window.prompt(
      'Адрес KinoLink-сервера в сети (например http://192.168.1.5:8080). Пусто — искать локально:',
      '',
    );
    const typed = normalizeUrl(answer ?? '');
    if (typed) {
      gmSet(SERVER_KEY, typed);
      base = typed;
    } else {
      gmSet(SERVER_KEY, LOCAL_SENTINEL);
    }
  }
  if (!base) base = await scanLocal();
  if (!base) {
    gmSet(SERVER_KEY, '');
    window.alert('Сервер KinoLink не найден. Запустите его и попробуйте снова.');
    return;
  }
  gmSet(SERVER_KEY, base);
  const url = base + buildPlayerQuery(movie, VERSION).slice(1);
  logger.info('opening player', url);
  if (!window.open(url, '_blank')) window.location.assign(url);
}
