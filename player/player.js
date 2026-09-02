/// <reference path="./config.js" />
/// <reference path="./utils.js" />

const containerElement = document.getElementById('container');
const contentElement = document.getElementById('content');
const headerElement = document.getElementById('header');
const sourcesElement = document.getElementById('sources');
const titleElement = document.getElementById('title');
const backgroundElement = document.getElementById('background');
const watchedToggleElement = document.getElementById('watched-toggle');
const watchedListElement = document.getElementById('watched-list');
const sidebarElement = document.getElementById('sidebar');
const sidebarCloseElement = document.querySelector('#sidebar .sidebar-close');
const sortToggleElement = document.getElementById('sort-toggle');
const themeToggleElement = document.getElementById('theme-toggle');
const themeSidebarElement = document.getElementById('theme-sidebar');
const themeCloseElement = document.querySelector('#theme-sidebar .sidebar-close');
const themeListElement = document.getElementById('theme-list');

let currentMovieKey = getSearchParam('movie') ?? '';
let currentTitle = '';
let currentResizeHandler = null;
let currentMovie = null;
let currentSources = [];
let currentEpisode = null;

const WATCHED_KEY = 'kinolink-watched-movies';
const WATCHED_SORT_KEY = 'kinolink-watched-sort';
const THEME_KEY = 'kinolink-theme';

const THEMES = {
	violet: { label: 'Виолетовая', description: 'тёмная с фиолетовым акцентом' },
	graphite: { label: 'Тёмно-серая', description: 'спокойная стальная гамма' },
	oled: { label: 'OLED', description: 'чистый чёрный, без фонов' },
	estvoid: { label: 'est-Void', description: 'инженерный минимализм' },
};

const THEME_CLASS = {
	violet: 'theme-violet',
	graphite: 'theme-graphite',
	oled: 'theme-oled',
	estvoid: 'theme-estvoid',
};

const LEGACY_THEME = { black: 'violet', purple: 'violet' };

let currentTheme = normalizeTheme(localStorage.getItem(THEME_KEY) || 'violet');
let watchedSort = localStorage.getItem(WATCHED_SORT_KEY) === 'desc' ? 'desc' : 'asc';

/**
 * @typedef {object} MovieData
 * @property {string} [kinopoisk]
 * @property {string} [imdb]
 * @property {string} [tmdb]
 * @property {'movie' | 'series'} [type]
 * @property {object[]} [sources] Pre-fetched sources in the form { type, iframeUrl }
 * @property {string} title
 */

const initializationTimeoutTimer = setTimeout(() => {
	logger.error('Initialization timeout');
	showMessage('Плеер не инициализировался. Обновите страницу и проверьте, что установлена актуальная версия скрипта.', 'error');
}, 5000);

/**
 * Initialize player
 * @param {object} data The movie data
 * @param {string} [scriptVersion] The version of the script
 */
async function init(data, scriptVersion) {
	try {
		containerElement.querySelectorAll('.message').forEach((element) => element.remove());

		currentMovie = null;
		currentSources = [];
		currentEpisode = null;

		const movieData = parseMovieData(data);

		logger.info('Initialization started', movieData);

		currentMovie = movieData;

		const key = cacheMovieData(movieData);
		currentMovieKey = key;

		if (movieData?.title) {
			saveWatchedMovie(movieData);
			renderWatchedMovies();
		}

		let sources = [];
		try {
			sources = await fetchSources(movieData);
		} catch (error) {
			if (error?.message === 'NOT_FOUND') {
				showPlayerText('Не удалось определить IMDb id для этого фильма');
				return;
			}
			logger.error('Error fetching data from server', error);
			showMessage('Источники временно недоступны. Попробуйте обновить страницу или открыть фильм позже.', 'error');
			return;
		}

		if (sources.length === 0) {
			showPlayerText('Источник не найден. Проверьте, что фильм доступен на Кинопоиске.');
			return;
		}

		setSources(sources);
		currentSources = sources;

		if (movieData?.title) {
			setTitle(movieData.title);
		}

		backgroundElement.classList.add('visible');
	} catch (error) {
		logger.error('Error during initialization', error);
		showMessage('Произошла ошибка во время запуска плеера.', 'error');
	}
}

/**
 * Build the embed URL for a provider entry.
 * @param {object} provider
 * @param {MovieData} movieData Data with { imdb, type, episode? }
 * @returns {string}
 */
function buildSourceUrl(provider, movieData) {
	if (typeof provider.build === 'function') return provider.build(movieData);
	return provider.template.replace('{imdb}', movieData.imdb);
}

/**
 * Fetch player sources for the movie.
 * Tries the Kinobox-compatible APIs (see KINOBOX_API_ENDPOINTS) first;
 * falls back to resolving the IMDb id (cached value, Wikidata or TMDB) and
 * building embed URLs from the providers configured in config.js.
 * @param {MovieData} movieData
 * @returns {Promise<object[]>} Sources in the form { type, iframeUrl }
 */
async function fetchSources(movieData) {
	const provided = Array.isArray(movieData?.sources)
		? movieData.sources.filter((source) => source?.iframeUrl && source?.type)
		: [];
	if (provided.length > 0) return provided;

	let sources = [];
	try {
		sources = await fetchKinoboxSources(movieData);
	} catch (error) {
		logger.warn('Kinobox sources unavailable, falling back to embed providers', error);
	}

	if (sources.length === 0) {
		const imdb = await resolveImdbId(movieData);
		if (!imdb) return [];
		if (movieData.type === 'series' && !currentEpisode) {
			currentEpisode = { season: 1, number: 1 };
		}
		currentMovie = { ...movieData, imdb, episode: currentEpisode };
		sources = PROVIDERS.map((provider) => ({
			type: provider.type,
			iframeUrl: buildSourceUrl(provider, currentMovie),
		}));
	}

	return sources;
}

/**
 * Fetch players from the Kinobox-compatible APIs, trying each configured
 * endpoint in order until one returns players (same request kinobox.js
 * makes: GET /api/players?kinopoisk=...).
 * @param {MovieData} movieData
 * @returns {Promise<object[]>}
 */
async function fetchKinoboxSources(movieData) {
	if (!movieData?.kinopoisk) return [];

	for (const endpoint of KINOBOX_API_ENDPOINTS) {
		try {
			const apiURL = new URL('/api/players', endpoint);
			apiURL.searchParams.set('kinopoisk', movieData.kinopoisk);

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 8000);
			let response = null;
			try {
				const request = await fetch(apiURL, { method: 'GET', signal: controller.signal });
				if (!request.ok) throw new Error(`Request failed with status ${request.status}`);
				response = await request.json();
			} finally {
				clearTimeout(timer);
			}

			if (!response || !Array.isArray(response?.data)) continue;

			const players = response.data
				.filter((player) => player?.iframeUrl && player?.type)
				.map((player) => ({ type: player.type, iframeUrl: player.iframeUrl }));

			// Kinobox finishes with the "turbo" player; keep that order
			const turboIndex = players.findIndex((player) => player.type.toLowerCase() === 'turbo');
			if (turboIndex !== -1) players.push(players.splice(turboIndex, 1)[0]);

			if (players.length > 0) return players;
		} catch (error) {
			logger.warn(`Kinobox endpoint "${endpoint}" failed`, error);
		}
	}

	return [];
}

const IMDB_CACHE_KEY = 'kinolink-imdb-cache';

/**
 * Get a cached IMDb id for the movie.
 * @param {MovieData} movieData
 * @returns {string}
 */
function getCachedImdb(movieData) {
	try {
		const raw = localStorage.getItem(IMDB_CACHE_KEY);
		const cache = raw ? JSON.parse(raw) : {};
		return (movieData && typeof cache[movieData.kinopoisk] === 'string' && cache[movieData.kinopoisk]) || '';
	} catch (error) {
		logger.warn('Failed to read IMDb cache', error);
		return '';
	}
}

/**
 * Store the resolved IMDb id in the cache.
 * @param {MovieData} movieData
 * @param {string} imdb
 */
function setCachedImdb(movieData, imdb) {
	if (!imdb || !movieData?.kinopoisk) return;
	try {
		const raw = localStorage.getItem(IMDB_CACHE_KEY);
		const cache = raw ? JSON.parse(raw) : {};
		cache[movieData.kinopoisk] = imdb;
		localStorage.setItem(IMDB_CACHE_KEY, JSON.stringify(cache));
	} catch (error) {
		logger.warn('Failed to save IMDb cache', error);
	}
}

/**
 * Fetch JSON with error handling.
 * @param {string | URL} url
 * @param {string} [accept]
 * @returns {Promise<any>}
 */
async function fetchJson(url, accept = 'application/json') {
	const response = await fetch(url, { headers: { Accept: accept } });
	if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
	return response.json();
}

/**
 * Resolve the IMDb id for the movie: from the given data, the local cache,
 * then through the configured resolvers (TMDB when a key is present,
 * Wikidata otherwise — no key required).
 * @param {MovieData} movieData
 * @returns {Promise<string>}
 */
async function resolveImdbId(movieData) {
	if (movieData?.imdb) return movieData.imdb;

	const cached = getCachedImdb(movieData);
	if (cached) return cached;

	const resolvers = [];
	if (TMDB_API_KEY) resolvers.push(resolveImdbFromTmdb.bind(null, movieData));
	resolvers.push(resolveImdbFromWikidata.bind(null, movieData));

	let lastError = null;
	for (const resolver of resolvers) {
		try {
			const imdb = await resolver();
			if (imdb) {
				setCachedImdb(movieData, imdb);
				return imdb;
			}
		} catch (error) {
			lastError = error;
			logger.warn('IMDb resolver failed', error);
		}
	}

	if (lastError) {
		lastError.message = `IMDb resolve failed: ${lastError.message}`;
		throw lastError;
	}
	throw new Error('NOT_FOUND');
}

/**
 * Resolve the IMDb id via TMDB (search by title + year or external_ids).
 * @param {MovieData} movieData
 * @returns {Promise<string>}
 */
async function resolveImdbFromTmdb(movieData) {
	const isSeries = movieData?.type === 'series';
	const collection = isSeries ? 'tv' : 'movie';

	if (movieData.tmdb) {
		try {
			const idUrl = new URL(`${TMDB_API_BASE}/${collection}/${movieData.tmdb}/external_ids`);
			idUrl.searchParams.set('api_key', TMDB_API_KEY);
			const external = await fetchJson(idUrl);
			if (external?.imdb_id) return external.imdb_id;
		} catch (error) {
			logger.warn('TMDB external_ids lookup failed, falling back to search', error);
		}
	}

	const searchUrl = new URL(`${TMDB_API_BASE}/search/${collection}`);
	searchUrl.searchParams.set('api_key', TMDB_API_KEY);
	searchUrl.searchParams.set('language', TMDB_LANGUAGE);
	searchUrl.searchParams.set('query', movieData.title);
	if (movieData.year) {
		searchUrl.searchParams.set(isSeries ? 'first_air_date_year' : 'year', movieData.year);
	}

	const searchData = await fetchJson(searchUrl);
	const results = (searchData?.results || []).filter((item) => item?.id);
	if (results.length === 0) return '';

	const matched =
		(movieData.year &&
			results.find((item) => String(item.release_date || item.first_air_date || '').slice(0, 4) === movieData.year)) ||
		results[0];

	const externalUrl = new URL(`${TMDB_API_BASE}/${collection}/${matched.id}/external_ids`);
	externalUrl.searchParams.set('api_key', TMDB_API_KEY);
	const external = await fetchJson(externalUrl);

	return external?.imdb_id || '';
}

/**
 * Resolve the IMDb id via the public no-key Wikidata SPARQL endpoint.
 * Matches the Kinopoisk film id (P2603) against the IMDb id (P345).
 * @param {MovieData} movieData
 * @returns {Promise<string>}
 */
async function resolveImdbFromWikidata(movieData) {
	if (!movieData?.kinopoisk) return '';

	const sparql =
		'SELECT ?imdb WHERE { ?item wdt:P2603 "' +
		movieData.kinopoisk +
		'" . ?item wdt:P345 ?imdb . }';
	const url = new URL('https://query.wikidata.org/bigdata/namespace/wdq/sparql');
	url.searchParams.set('query', sparql);

	const data = await fetchJson(url, 'application/sparql-results+json');
	const binding = data?.results?.bindings?.[0];
	return binding?.imdb?.value || '';
}

/**
 * Update list of available sources. Renders a segmented control with a
 * floating accent indicator that "crawls" to the selected player.
 * @param {object[]} sourcesData
 */
function setSources(sourcesData) {
	sourcesElement.innerHTML = '';
	sourcesElement.setAttribute('role', 'tablist');

	if (currentResizeHandler) {
		window.removeEventListener('resize', currentResizeHandler);
	}

	const indicator = document.createElement('div');
	indicator.className = 'source-indicator';
	sourcesElement.appendChild(indicator);

	const preferredSource = localStorage.getItem('preferred-source');
	let preferredSourceIndex = sourcesData.findIndex((source) => source.type === preferredSource);
	if (preferredSourceIndex === -1) preferredSourceIndex = 0;

	sourcesData.forEach((source, index) => {
		const sourceElement = document.createElement('button');
		sourceElement.className = 'source';
		sourceElement.setAttribute('role', 'tab');
		sourceElement.innerText = source?.type;

		if (index === preferredSourceIndex) {
			sourceElement.classList.add('selected');
			selectSource(source);
		}

		sourceElement.addEventListener('click', () => {
			if (sourceElement.classList.contains('selected')) return;

			sourcesElement.querySelectorAll('.source').forEach((element) => element.classList.remove('selected'));
			sourceElement.classList.add('selected');
			localStorage.setItem('preferred-source', source.type);
			selectSource(source);
			updateSourceIndicator();
		});

		sourcesElement.appendChild(sourceElement);
	});

	const updateSourceIndicator = () => {
		const selected = sourcesElement.querySelector('.source.selected');
		if (!selected) return;
		const offset = selected.offsetLeft - sourcesElement.offsetLeft;
		const width = selected.offsetWidth;
		indicator.style.transform = `translateX(${offset}px)`;
		indicator.style.width = `${width}px`;
	};

	currentResizeHandler = updateSourceIndicator;

	requestAnimationFrame(updateSourceIndicator);
	window.addEventListener('resize', updateSourceIndicator);
}

/**
 * Select source to display in the player
 * @param {object} sourceData
 */
function selectSource(sourceData) {
	const frame = document.createElement('div');
	frame.className = 'frame';

	const iframe = document.createElement('iframe');
	iframe.src = sourceData?.iframeUrl;
	iframe.allowFullscreen = true;

	frame.appendChild(iframe);
	contentElement.innerHTML = '';
	contentElement.appendChild(frame);

	fitPlayerFrame();
}

/**
 * Size the player frame to the largest 16:9 size that fits the viewport
 * below the header and the sources bar, so the video leaves no empty space
 * around it (the container card wraps tightly around the player).
 */
function fitPlayerFrame() {
	const frame = contentElement.querySelector('.frame');
	if (!frame) return;

	const chrome = (headerElement?.offsetHeight ?? 64) + (sourcesElement?.offsetHeight ?? 56) + 24;
	const availableHeight = Math.max(window.innerHeight - chrome - 12, 120);

	let width = contentElement.clientWidth || window.innerWidth;
	if (width / (16 / 9) > availableHeight) width = availableHeight * (16 / 9);

	frame.style.width = `${Math.floor(width)}px`;
}

function setTitle(title) {
	currentTitle = title;
	document.title = `${title} | KinoLink`;
	if (titleElement) {
		titleElement.textContent = title ?? '';
	}
}

function normalizeTheme(theme) {
	if (THEME_CLASS[theme]) return theme;
	if (LEGACY_THEME[theme]) return LEGACY_THEME[theme];
	return 'violet';
}

function updateThemeOptionStates() {
	themeListElement?.querySelectorAll('.theme-option').forEach((option) => {
		const active = option.dataset.theme === currentTheme;
		option.classList.toggle('active', active);
		option.setAttribute('aria-pressed', String(active));
	});
}

function applyTheme(theme) {
	currentTheme = normalizeTheme(theme);
	document.body.classList.remove(...Object.values(THEME_CLASS));
	document.body.classList.add(THEME_CLASS[currentTheme]);
	localStorage.setItem(THEME_KEY, currentTheme);
	updateThemeOptionStates();
}

function renderThemeOptions() {
	if (!themeListElement) return;
	themeListElement.innerHTML = '';
	Object.entries(THEMES).forEach(([id, meta]) => {
		const option = document.createElement('button');
		option.type = 'button';
		option.dataset.theme = id;
		option.className = 'theme-option';
		option.setAttribute('aria-pressed', String(id === currentTheme));

		const name = document.createElement('span');
		name.className = 'theme-name';
		name.textContent = meta.label;

		const desc = document.createElement('span');
		desc.className = 'theme-desc';
		desc.textContent = meta.description;

		option.append(name, desc);
		option.addEventListener('click', () => applyTheme(id));
		themeListElement.appendChild(option);
	});
	updateThemeOptionStates();
}

function toggleThemeSidebar(open) {
	if (!themeSidebarElement) return;
	const willOpen = open ?? !themeSidebarElement.classList.contains('open');
	if (willOpen) {
		toggleSidebar(false);
		renderThemeOptions();
	}
	themeSidebarElement.classList.toggle('open', willOpen);
	themeToggleElement?.setAttribute('aria-expanded', String(willOpen));
	themeToggleElement?.classList.toggle('active', willOpen);
}

function cacheMovieData(movieData) {
	const serialized = JSON.stringify(movieData);
	const key = hashCode(serialized);

	localStorage.setItem(key, serialized);
	return key;
}

/**
 * Validate and clean the movie data
 * @param {string | object} data
 * @returns {MovieData}
 * @throws Will throw an error if the data is invalid
 */
function parseMovieData(data) {
	if (typeof data !== 'object' || data === null) {
		throw new Error(`Invalid movie data type: "${typeof data}"`);
	}

	const allowedKeys = ['imdb', 'tmdb', 'kinopoisk', 'title', 'cover', 'genre', 'year', 'type', 'sources'];
	Object.keys(data).forEach((key) => {
		if (!allowedKeys.includes(key)) delete data[key];
	});

	return data;
}

/**
 * Show a dismissible notification inside the player.
 * @param {string} text The notification text
 * @param {'error' | undefined} [type] Message style
 * @returns {HTMLElement} The message element
 */
function showMessage(text, type) {
	const message = document.createElement('div');
	message.className = type === 'error' ? 'message error' : 'message';

	const body = document.createElement('p');
	body.textContent = text;
	message.appendChild(body);

	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'message-close';
	close.setAttribute('aria-label', 'Закрыть');
	close.textContent = '×';
	close.addEventListener('click', () => message.remove());
	message.appendChild(close);

	containerElement.appendChild(message);
	return message;
}

/**
 * Show plain text inside the player frame.
 * @param {string} messageText The message to display
 */
function showPlayerText(messageText) {
	const playerTextElement = document.createElement('span');
	playerTextElement.textContent = messageText;
	playerTextElement.style.animation = 'fadeIn 0.3s ease both';

	contentElement.innerHTML = '';
	contentElement.appendChild(playerTextElement);
}

/**
 * Persist a movie in the watched list (stored separately from the source cache).
 * @param {MovieData} movieData
 */
function saveWatchedMovie(movieData) {
	if (!movieData?.title) return;

	let watched = getWatchedMovies();
	const existing = watched.find((item) => item.title === movieData.title);
	watched = watched.filter((item) => item.title !== movieData.title);
	watched.unshift({
		kinopoisk: movieData.kinopoisk ?? '',
		type: movieData.type ?? 'movie',
		title: movieData.title,
		cover: movieData.cover || existing?.cover || '',
		genre: movieData.genre || existing?.genre || '',
		year: movieData.year || existing?.year || '',
		timestamp: Date.now(),
	});

	try {
		localStorage.setItem(WATCHED_KEY, JSON.stringify(watched));
	} catch (error) {
		logger.warn('Failed to save watched list', error);
	}
}

/**
 * Get the stored watched movies list.
 * @returns {{ kinopoisk: string, type: string, title: string, cover: string, genre: string, year: string, timestamp: number }[]}
 */
function getWatchedMovies() {
	try {
		const raw = localStorage.getItem(WATCHED_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed;
	} catch (error) {
		logger.warn('Failed to read watched list', error);
		return [];
	}
}

/**
 * Route remote cover images through the local server (same-origin with the
 * player page) so strict browser privacy settings cannot block the CDN.
 * @param {string} rawUrl
 */
function resolveCoverUrl(rawUrl) {
	if (!rawUrl) return '';
	try {
		const parsed = new URL(rawUrl);
		if (parsed.origin !== location.origin) {
			return `/cover?url=${encodeURIComponent(rawUrl)}`;
		}
	} catch {
		return rawUrl;
	}
	return rawUrl;
}

/**
 * Backfill covers for watched entries that were saved without one — the most
 * reliable instant source is the currently loaded movie's fresh data.
 */
function syncCurrentCover() {
	if (!currentMovie?.cover || !currentMovie?.title) return;

	let changed = false;
	const movies = getWatchedMovies().map((movie) => {
		if (!movie.cover && movie.title === currentMovie.title) {
			changed = true;
			return { ...movie, cover: currentMovie.cover };
		}
		return movie;
	});

	if (changed) {
		try {
			localStorage.setItem(WATCHED_KEY, JSON.stringify(movies));
		} catch (error) {
			logger.warn('Failed to update watched covers', error);
		}
	}
}

/**
 * Render the watched movies sidebar.
 */
function renderWatchedMovies() {
	if (!watchedListElement) return;

	syncCurrentCover();

	const watched = getWatchedMovies();
	watchedListElement.innerHTML = '';

	if (watched.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'watched-empty';
		empty.textContent = 'Тут пока пусто';
		watchedListElement.appendChild(empty);
		return;
	}

	const direction = watchedSort === 'desc' ? -1 : 1;
	const sorted = watched
		.map((movie) => ({ ...movie }))
		.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru', { sensitivity: 'base' }) * direction);

	const fragment = document.createDocumentFragment();

	sorted.forEach((movie) => {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'watched-item';
		item.title = 'Открыть в плеере';
		if (movie.title === currentTitle) item.classList.add('selected');
		item.addEventListener('click', () => loadWatchedMovie(movie));

		const cover = document.createElement('img');
		cover.className = 'cover';
		cover.alt = '';
		if (movie.cover) {
			cover.src = resolveCoverUrl(movie.cover);
			cover.addEventListener('error', () => {
				cover.style.display = 'none';
			});
		}

		const info = document.createElement('span');
		info.className = 'info';

		const title = document.createElement('span');
		title.className = 'row title';
		title.textContent = movie.title ?? '';

		const genre = document.createElement('span');
		genre.className = 'row';
		genre.textContent = movie.genre || '—';

		const year = document.createElement('span');
		year.className = 'row';
		year.textContent = movie.year || '—';

		info.appendChild(title);
		info.appendChild(genre);
		info.appendChild(year);

		item.appendChild(cover);
		item.appendChild(info);
		fragment.appendChild(item);
	});

	watchedListElement.appendChild(fragment);
}

/**
 * Load a movie from the watched list into the player. Sources are always
 * re-fetched fresh (stored iframe tokens would expire), so the movie loads
 * reliably even long after it was added to the list.
 * @param {{ kinopoisk: string, type?: string, title: string, cover: string, genre: string, year: string }} movie
 */
function loadWatchedMovie(movie) {
	toggleSidebar(false);

	const data = {
		kinopoisk: movie.kinopoisk || undefined,
		type: movie.type === 'series' ? 'series' : 'movie',
		title: movie.title,
		cover: movie.cover || undefined,
		genre: movie.genre || undefined,
		year: movie.year || undefined,
	};

	logger.info('Loading watched movie', data);
	init(data);
}

/**
 * Toggle the watched sidebar.
 * @param {boolean} open
 */
function toggleSidebar(open) {
	const isOpen = sidebarElement?.classList.toggle('open', open);
	watchedToggleElement?.classList.toggle('active', open);
	if (watchedToggleElement) watchedToggleElement.setAttribute('aria-expanded', String(open));
	if (open) {
		toggleThemeSidebar(false);
		renderWatchedMovies();
	}
	return isOpen;
}

function updateSortToggleLabel() {
	if (!sortToggleElement) return;
	const ascending = watchedSort === 'asc';
	sortToggleElement.textContent = ascending ? 'A–Z' : 'Z–A';
	sortToggleElement.setAttribute('aria-label', ascending ? 'Порядок: по алфавиту (A–Z)' : 'Порядок: в обратном алфавиту (Z–A)');
}

function toggleWatchedSort() {
	watchedSort = watchedSort === 'asc' ? 'desc' : 'asc';
	localStorage.setItem(WATCHED_SORT_KEY, watchedSort);
	updateSortToggleLabel();
	if (sidebarElement?.classList.contains('open')) renderWatchedMovies();
}

/**
 * Setup the script by getting cached movie data from URL
 */
function setup() {
	applyTheme(currentTheme);
	try {
		logger.info('Setup started');

		watchedToggleElement?.addEventListener('click', () => {
			const willOpen = !sidebarElement?.classList.contains('open');
			toggleSidebar(willOpen);
		});

		sidebarCloseElement?.addEventListener('click', () => toggleSidebar(false));

		sortToggleElement?.addEventListener('click', toggleWatchedSort);
		updateSortToggleLabel();

		themeToggleElement?.addEventListener('click', () => {
			const willOpen = !themeSidebarElement?.classList.contains('open');
			toggleThemeSidebar(willOpen);
		});

		themeCloseElement?.addEventListener('click', () => toggleThemeSidebar(false));

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				toggleSidebar(false);
				toggleThemeSidebar(false);
			}
		});

		window.addEventListener('resize', fitPlayerFrame);

		const movieParam = getSearchParam('movie');
		if (movieParam) {
			let parsed = null;
			try {
				parsed = JSON.parse(movieParam);
			} catch (error) {
				try {
					parsed = JSON.parse(decodeURIComponent(movieParam));
				} catch (error2) {
					/* not JSON */
				}
			}

			if (parsed && typeof parsed === 'object' && typeof parsed.title === 'string') {
				logger.info('Movie data from URL:', parsed);
				init(parsed);
				return;
			}

			// Search param is a plain cache key -> look it up in local storage
			const cachedByMovie = localStorage.getItem(movieParam);
			if (cachedByMovie) {
				try {
					const cachedMovie = JSON.parse(cachedByMovie);
					if (typeof cachedMovie === 'object' && cachedMovie !== null && cachedMovie.title) {
						logger.info('Cached data found by movie param:', cachedMovie);
						currentMovieKey = movieParam;
						init(cachedMovie);
						return;
					}
				} catch (error) {
					logger.warn('Failed to parse cached movie data', error);
				}
			}
		}

		const movieKey = getSearchParam('key');
		if (movieKey) currentMovieKey = movieKey;

		const cachedData = movieKey ? localStorage.getItem(movieKey) : null;
		if (!cachedData) return;

		const movieData = JSON.parse(cachedData);
		if (typeof movieData !== 'object') return;

		logger.info('Cached data was found:', movieData);
		init(movieData);
	} catch (error) {
		logger.error('Setup error', error);
	}
	clearTimeout(initializationTimeoutTimer);
}

document.addEventListener('DOMContentLoaded', setup);
