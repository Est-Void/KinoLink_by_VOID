// Per-site movie extractors. Each returns a raw record; validation and
// defaults happen centrally in shared parseMovieRef(). Null = not a
// movie page (or title not readable yet) — no button is shown.

export type Site = 'kinopoisk' | 'imdb' | 'tmdb' | 'letterboxd' | 'netflix' | 'rottentomatoes';

export interface RawRef {
  title: string;
  kinopoisk?: string;
  imdb?: string;
  tmdb?: string;
  netflix?: string;
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
  if (isDomain(host, 'netflix.com') && /^\/title\/\d+/.test(path)) return 'netflix';
  if (isDomain(host, 'rottentomatoes.com') && /^\/(m|tv)\//.test(path)) return 'rottentomatoes';
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

// Cover candidates in v1 order: JSON-LD poster first, then meta tags, then a
// raw-HTML scan (Kinopoisk injects the poster via scripts, so meta may be absent).
function coverFromMeta(): string {
  const read = (selector: string, attribute = 'content'): string =>
    document.querySelector(selector)?.getAttribute(attribute)?.trim() ?? '';
  return (
    read('meta[property="og:image:secure_url"]') ||
    read('meta[property="og:image"]') ||
    read('meta[property="og:image:url"]') ||
    read('meta[name="twitter:image"]') ||
    read('meta[itemprop="image"]') ||
    read('link[rel="image_src"]', 'href')
  );
}

function imageUrl(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return imageUrl(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.url === 'string') return record.url;
    if (typeof record.contentUrl === 'string') return record.contentUrl;
  }
  return '';
}

// Resolve relative/protocol-relative URLs and drop anything that is not http(s).
function absoluteUrl(raw: string): string {
  if (!raw) return '';
  try {
    const url = new URL(raw, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

// Kinopoisk renders the poster into the DOM; scan the HTML as a last resort.
function kinopoiskPosterFromHtml(): string {
  const html = document.documentElement?.innerHTML ?? '';
  const urls =
    html.match(/https:\/\/avatars\.mds\.yandex\.net\/get-kinopoisk-image\/[^"'\\\s>]+/g) ?? [];
  for (const marker of ['600x900', '400x600', '300x450', 'original']) {
    const hit = urls.find((url) => url.includes(marker) && !url.includes('.webp'));
    if (hit) return hit;
  }
  return urls[0] ?? '';
}

interface JsonLdInfo {
  year: string;
  genre: string;
  image: string;
}

// Year, genre and poster from ld+json markup (v1 approach, incl. @graph).
function readJsonLd(): JsonLdInfo {
  const info: JsonLdInfo = { year: '', genre: '', image: '' };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (!info.year && typeof record.datePublished === 'string' && /^\d{4}/.test(record.datePublished)) {
      info.year = record.datePublished.slice(0, 4);
    }
    if (!info.genre && Array.isArray(record.genre)) {
      info.genre = record.genre.filter((g): g is string => typeof g === 'string').join(', ');
    }
    if (!info.image) info.image = imageUrl(record.image) || imageUrl(record.primaryImageOfPage);
    if (record['@graph']) visit(record['@graph']);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      visit(JSON.parse(script.textContent ?? ''));
    } catch { /* ignore malformed blocks */ }
  });
  return info;
}

function pageCover(jsonLdImage: string, scanHtml = false): string {
  return (
    absoluteUrl(jsonLdImage) ||
    absoluteUrl(coverFromMeta()) ||
    (scanHtml ? absoluteUrl(kinopoiskPosterFromHtml()) : '')
  );
}

// Год и жанр со страницы Кинопоиска (ld+json разметка, как в v1).
function extractKinopoisk(): RawRef | null {
  const match = location.pathname.match(/^\/(film|series)\/(\d+)/);
  if (!match) return null;
  let title = ogTitle();
  if (!title || title.startsWith('Кинопоиск.')) return null;
  title = title.replace('— смотреть онлайн в хорошем качестве — Кинопоиск', '').trim();
  if (!title) return null;
  const ld = readJsonLd();
  return {
    kinopoisk: match[2],
    type: match[1] === 'series' ? 'series' : 'movie',
    title,
    cover: pageCover(ld.image, true),
    year: ld.year,
    genre: ld.genre,
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
  return { imdb: seriesLink ?? fromUrl, title, cover: pageCover(readJsonLd().image) };
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
    cover: pageCover(readJsonLd().image),
  };
}

function extractLetterboxd(): RawRef | null {
  const title = ogTitle();
  if (!title) return null;
  const cover = pageCover(readJsonLd().image);
  const ids = idsFromLinks();
  if (ids.imdb || ids.tmdb) return { ...ids, title, cover };
  return null;
}

// Исходящие ссылки страницы как источник imdb/tmdb id (Letterboxd, RT).
function idsFromLinks(): { imdb?: string; tmdb?: string } {
  const links = Array.from(document.querySelectorAll('a[href]'));
  const imdb = links
    .find((a) => /imdb\.com\/title\/tt\d+/.test(a.getAttribute('href') ?? ''))
    ?.getAttribute('href')
    ?.match(/\/title\/(tt\d+)/)?.[1];
  if (imdb) return { imdb };
  const tmdb = links
    .find((a) => /themoviedb\.org\/(movie|tv)\/\d+/.test(a.getAttribute('href') ?? ''))
    ?.getAttribute('href')
    ?.match(/\/(?:movie|tv)\/(\d+)/)?.[1];
  return tmdb ? { tmdb } : {};
}

// Netflix: og:title + releaseYear/videoType из встроенного JSON. Классы DOM
// хешированы, данные лежат в react/falcor-скриптах — сканируем HTML.
function extractNetflix(): RawRef | null {
  const id = location.pathname.match(/^\/title\/(\d+)/)?.[1];
  if (!id) return null;
  let title = ogTitle();
  if (!title) return null;
  title = title
    .replace(/^Watch\s+/i, '')
    .replace(/\s*[–|]\s*Netflix\s*$/i, '')
    .trim();
  if (!title) return null;
  const html = document.documentElement?.innerHTML ?? '';
  const year = html.match(/"releaseYear":\s*{\s*"year":\s*(\d{4})/)?.[1];
  const videoType = html.match(/"videoType":\s*"(movie|show)"/)?.[1];
  return {
    netflix: id,
    title,
    type: videoType === 'show' ? 'series' : 'movie',
    year,
  };
}

// Rotten Tomatoes: тип из пути, id — из ссылок на IMDb/TMDB в инфоблоке.
function extractRottentomatoes(): RawRef | null {
  const match = location.pathname.match(/^\/(m|tv)\/[a-z0-9_]+/i);
  if (!match) return null;
  let title = ogTitle();
  if (!title) return null;
  title = title.replace(/\s*[-–|]\s*Rotten Tomatoes\s*$/i, '').trim();
  if (!title) return null;
  return {
    ...idsFromLinks(),
    title,
    type: match[1] === 'tv' ? 'series' : 'movie',
    cover: pageCover(readJsonLd().image),
  };
}

export const extractors: Record<Site, () => RawRef | null> = {
  kinopoisk: extractKinopoisk,
  imdb: extractImdb,
  tmdb: extractTmdb,
  letterboxd: extractLetterboxd,
  netflix: extractNetflix,
  rottentomatoes: extractRottentomatoes,
};
