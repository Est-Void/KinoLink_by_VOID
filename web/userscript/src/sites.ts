// Per-site movie extractors. Each returns a raw record; validation and
// defaults happen centrally in shared parseMovieRef(). Null = not a
// movie page (or title not readable yet) — no button is shown.

export type Site = 'kinopoisk' | 'imdb' | 'tmdb' | 'letterboxd';

export interface RawRef {
  title: string;
  kinopoisk?: string;
  imdb?: string;
  tmdb?: string;
  type?: 'movie' | 'series';
}

// Exact domain or a real subdomain — rejects lookalikes like "notkinopoisk.ru".
function isDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Pure host/path mapping, split out so it can be unit-tested without a DOM. */
export function siteFor(host: string, path: string): Site | null {
  if (isDomain(host, 'kinopoisk.ru')) return 'kinopoisk';
  if (isDomain(host, 'imdb.com') && path.startsWith('/title/tt')) return 'imdb';
  if (isDomain(host, 'themoviedb.org') && /^\/(movie|tv)\//.test(path)) return 'tmdb';
  if (isDomain(host, 'letterboxd.com') && path.startsWith('/film/')) return 'letterboxd';
  return null;
}

export function detectSite(): Site | null {
  return siteFor(location.hostname, location.pathname);
}

function ogTitle(): string {
  return (
    document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ??
    ''
  );
}

function extractKinopoisk(): RawRef | null {
  const match = location.pathname.match(/^\/(film|series)\/(\d+)/);
  if (!match) return null;
  let title = ogTitle();
  if (!title || title.startsWith('Кинопоиск.')) return null;
  title = title.replace('— смотреть онлайн в хорошем качестве — Кинопоиск', '').trim();
  if (!title) return null;
  return {
    kinopoisk: match[2],
    type: match[1] === 'series' ? 'series' : 'movie',
    title,
  };
}

function extractImdb(): RawRef | null {
  const fromUrl = location.pathname.match(/^\/title\/(tt\d+)/)?.[1];
  if (!fromUrl) return null;
  // Opened episode of a series: resolve back to the series itself.
  const seriesLink = document
    .querySelector('a[data-testid="hero-title-block__series-link"]')
    ?.getAttribute('href')
    ?.match(/\/title\/(tt\d+)/)?.[1];
  let title = ogTitle();
  if (!title) return null;
  if (title.includes('⭐')) title = title.split('⭐')[0].trim();
  if (title.endsWith('- IMDb') && title.includes(')')) {
    title = title.slice(0, title.lastIndexOf(')') + 1).trim();
  }
  if (!title) return null;
  return { imdb: seriesLink ?? fromUrl, title };
}

function extractTmdb(): RawRef | null {
  const match = location.pathname.match(/^\/(movie|tv)\/(\d+)/);
  if (!match) return null;
  const title = ogTitle();
  if (!title) return null;
  return {
    tmdb: match[2],
    type: match[1] === 'tv' ? 'series' : 'movie',
    title,
  };
}

function extractLetterboxd(): RawRef | null {
  const title = ogTitle();
  if (!title) return null;
  const links = Array.from(document.querySelectorAll('a[href]'));
  const imdb = links
    .find((a) => /imdb\.com\/title\/tt\d+/.test(a.getAttribute('href') ?? ''))
    ?.getAttribute('href')
    ?.match(/\/title\/(tt\d+)/)?.[1];
  if (imdb) return { imdb, title };
  const tmdb = links
    .find((a) => /themoviedb\.org\/(movie|tv)\/\d+/.test(a.getAttribute('href') ?? ''))
    ?.getAttribute('href')
    ?.match(/\/(?:movie|tv)\/(\d+)/)?.[1];
  if (tmdb) return { tmdb, title };
  return null;
}

export const extractors: Record<Site, () => RawRef | null> = {
  kinopoisk: extractKinopoisk,
  imdb: extractImdb,
  tmdb: extractTmdb,
  letterboxd: extractLetterboxd,
};
