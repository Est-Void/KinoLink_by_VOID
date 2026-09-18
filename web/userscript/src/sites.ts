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
  cover?: string;
  year?: string;
  genre?: string;
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

function ogImage(): string {
  return (
    document.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content')?.trim() ??
    document.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() ??
    ''
  );
}

// Год и жанр со страницы Кинопоиска (ld+json разметка, как в v1).
function kinopoiskDetails(): { year: string; genre: string } {
  let year = '';
  let genre = '';
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (typeof node !== 'object' || node === null) continue;
        if (!year && typeof node.datePublished === 'string' && /^\d{4}/.test(node.datePublished)) {
          year = node.datePublished.slice(0, 4);
        }
        if (!genre && Array.isArray(node.genre)) {
          genre = node.genre.filter((g: unknown) => typeof g === 'string').join(', ');
        }
      }
    } catch { /* ignore malformed blocks */ }
  });
  return { year, genre };
}

function extractKinopoisk(): RawRef | null {
  const match = location.pathname.match(/^\/(film|series)\/(\d+)/);
  if (!match) return null;
  let title = ogTitle();
  if (!title || title.startsWith('Кинопоиск.')) return null;
  title = title.replace('— смотреть онлайн в хорошем качестве — Кинопоиск', '').trim();
  if (!title) return null;
  const { year, genre } = kinopoiskDetails();
  return {
    kinopoisk: match[2],
    type: match[1] === 'series' ? 'series' : 'movie',
    title,
    cover: ogImage(),
    year,
    genre,
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
  return { imdb: seriesLink ?? fromUrl, title, cover: ogImage() };
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
    cover: ogImage(),
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
  if (imdb) return { imdb, title, cover: ogImage() };
  const tmdb = links
    .find((a) => /themoviedb\.org\/(movie|tv)\/\d+/.test(a.getAttribute('href') ?? ''))
    ?.getAttribute('href')
    ?.match(/\/(?:movie|tv)\/(\d+)/)?.[1];
  if (tmdb) return { tmdb, title, cover: ogImage() };
  return null;
}

export const extractors: Record<Site, () => RawRef | null> = {
  kinopoisk: extractKinopoisk,
  imdb: extractImdb,
  tmdb: extractTmdb,
  letterboxd: extractLetterboxd,
};
