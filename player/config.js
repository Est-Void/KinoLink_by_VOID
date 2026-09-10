const KINOBOX_API_ENDPOINTS = [
	'https://fbphdplay.top',
	'https://api.kinobox.tv',
];

const TMDB_API_KEY = '';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_LANGUAGE = 'ru-RU';

// Минимальная версия юзерскрипта, с которой корректно работает плеер.
// Синхронизируй с @version в userscript/kinolink.user.js при релизе.
const REQUIRED_SCRIPT_VERSION = '0.8.7-dev';

// Ссылка на обновление скрипта (та же, что в README → установка скрипта).
const SCRIPT_UPDATE_URL = 'https://github.com/Est-Void/KinoLink_by_VOID/raw/main/userscript/kinolink.user.js';

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
