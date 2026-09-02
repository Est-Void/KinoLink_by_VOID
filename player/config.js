// Latest required script version
const REQUIRED_VERSION = '0.4.6';

// Kinobox-compatible player APIs queried directly by the player page.
// `fbphdplay.top` is the same API that FlicksBar uses (CORS `*`, reachable
// from anywhere); `api.kinobox.tv` is the original. Endpoints are tried in
// order until one returns players, so the blocked kinobox.tv never slows
// the player down.
const KINOBOX_API_ENDPOINTS = [
	'https://fbphdplay.top',
	'https://api.kinobox.tv',
];

// TMDB API key: get one for free at https://www.themoviedb.org/settings/api
const TMDB_API_KEY = '';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_LANGUAGE = 'ru-RU';

// Embedded player providers. These are only a fallback: the primary sources
// come from the Kinobox-compatible APIs listed in KINOBOX_API_ENDPOINTS,
// which the player queries directly (CORS `*`).
// Each entry provides a `build(movieData)` function returning the embed URL.
// `movieData` contains { imdb, type: 'movie' | 'series' } plus
// `episode: { season, number }` for series (defaults to 1/1).
function embedUrl(movieData, moviePath, seriesPath) {
	const imdb = movieData.imdb;
	const episode = { season: 1, number: 1, ...(movieData.episode || {}) };
	return movieData.type === 'series' ? seriesPath(imdb, episode) : moviePath(imdb);
}

const PROVIDERS = [
	{
		type: 'vidsrc.me',
		build: (movieData) =>
			embedUrl(
				movieData,
				(imdb) => `https://vidsrc.me/embed/movie/${imdb}`,
				(imdb, episode) =>
					`https://vidsrc.me/embed/tv/${imdb}/${episode.season}/${episode.number}`,
			),
	},
	{
		type: 'vidsrc.to',
		build: (movieData) =>
			embedUrl(
				movieData,
				(imdb) => `https://vidsrc.to/embed/movie/${imdb}`,
				(imdb, episode) =>
					`https://vidsrc.to/embed/tv/${imdb}/${episode.season}/${episode.number}`,
			),
	},
];