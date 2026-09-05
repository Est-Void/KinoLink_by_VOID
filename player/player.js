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
const episodeBarElement = document.getElementById('episode-bar');
const seasonLabelElement = document.getElementById('season-label');
const episodeLabelElement = document.getElementById('episode-label');
const seasonPrevElement = document.getElementById('season-prev');
const seasonNextElement = document.getElementById('season-next');
const episodePrevElement = document.getElementById('episode-prev');
const episodeNextElement = document.getElementById('episode-next');
const episodeNextBtnElement = document.getElementById('episode-next-btn');

let currentMovieKey = getSearchParam('movie') ?? '';
let currentResizeHandler = null;
let currentMovie = null;
let currentSources = [];
let currentEpisode = null;
let currentSource = null;

const EPISODE_KEY = 'kinolink-episodes';
const WATCHED_KEY = 'kinolink-watched-movies';
const WATCHED_SORT_KEY = 'kinolink-watched-sort';
const THEME_KEY = 'kinolink-theme';

const THEMES = {
	violet: { label: 'Виолетовая' },
	graphite: { label: 'Тёмно-серая' },
	oled: { label: 'OLED' },
	estvoid: { label: 'est-Void' },
	cosmic: { label: 'Космос' },
	dynamic: { label: 'Динамический' },
};

const THEME_CLASS = {
	violet: 'theme-violet',
	graphite: 'theme-graphite',
	oled: 'theme-oled',
	estvoid: 'theme-estvoid',
	cosmic: 'theme-cosmic',
	dynamic: 'theme-dynamic',
};

const LEGACY_THEME = { black: 'violet', purple: 'violet' };

const MORPH_FADE = 450;

let currentTheme = normalizeTheme(localStorage.getItem(THEME_KEY) || 'violet');
let watchedSort = localStorage.getItem(WATCHED_SORT_KEY) === 'desc' ? 'desc' : 'asc';

const initializationTimeoutTimer = setTimeout(() => {
	logger.error('Initialization timeout');
	showMessage('Плеер не инициализировался. Обновите страницу и проверьте, что установлена актуальная версия скрипта.', 'error');
}, 15000);

function clearInitializationTimeout() {
	clearTimeout(initializationTimeoutTimer);
}

async function init(data, scriptVersion) {
	try {
		containerElement.querySelectorAll('.message').forEach((element) => element.remove());

		currentMovie = null;
		currentSources = [];
		currentEpisode = null;
		currentSource = null;

		const movieData = parseMovieData(data);

		logger.info('Initialization started', movieData);

		currentMovie = movieData;
		if (movieData?.type === 'series') {
			currentEpisode = loadEpisode(movieData);
			currentMovie = { ...movieData, episode: currentEpisode };
		}
		renderEpisodeBar();

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
				clearInitializationTimeout();
				showPlayerText('Не удалось определить IMDb id для этого фильма');
				return;
			}
			logger.error('Error fetching data from server', error);
			clearInitializationTimeout();
			showMessage('Источники временно недоступны. Попробуйте обновить страницу или открыть фильм позже.', 'error');
			return;
		}

		if (sources.length === 0) {
			clearInitializationTimeout();
			showPlayerText('Источник не найден. Проверьте, что фильм доступен на Кинопоиске.');
			return;
		}

		setSources(sources);
		currentSources = sources;

		if (movieData?.title) {
			setTitle(movieData.title);
		}

		backgroundElement.classList.add('visible');
		clearInitializationTimeout();

		if (currentTheme === 'dynamic') {
			applyDynamicBackdrop(movieData.cover);
		}
	} catch (error) {
		clearInitializationTimeout();
		logger.error('Error during initialization', error);
		showMessage('Произошла ошибка во время запуска плеера.', 'error');
	}
}

function buildSourceUrl(provider, movieData) {
	if (typeof provider.build === 'function') return provider.build(movieData);
	return provider.template.replace('{imdb}', movieData.imdb);
}

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
		currentMovie = { ...movieData, imdb, episode: currentEpisode };
		sources = PROVIDERS.map((provider) => ({
			type: provider.type,
			iframeUrl: buildSourceUrl(provider, currentMovie),
			provider,
		}));
	}

	return sources;
}

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

async function fetchJson(url, accept = 'application/json') {
	const response = await fetch(url, { headers: { Accept: accept } });
	if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
	return response.json();
}

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

function selectSource(sourceData) {
	currentSource = sourceData;

	let url = sourceData?.iframeUrl ?? '';
	if (currentMovie?.type === 'series' && currentEpisode) {
		if (sourceData?.provider) {
			url = buildSourceUrl(sourceData.provider, { ...currentMovie, episode: currentEpisode });
		} else {
			url = applyEpisodeToUrl(url);
		}
	}

	const frame = document.createElement('div');
	frame.className = 'frame';

	const iframe = document.createElement('iframe');
	iframe.src = url;
	iframe.allowFullscreen = true;

	frame.appendChild(iframe);
	contentElement.innerHTML = '';
	contentElement.appendChild(frame);

	fitPlayerFrame();
}

function applyEpisodeToUrl(url) {
	try {
		const parsed = new URL(url, location.href);
		parsed.searchParams.set('season', String(currentEpisode.season));
		parsed.searchParams.set('episode', String(currentEpisode.number));
		return parsed.toString();
	} catch {
		return url;
	}
}

function episodeStorageKey(movie) {
	return movie?.kinopoisk ? `kp:${movie.kinopoisk}` : `t:${movie?.title ?? ''}`;
}

function loadEpisode(movie) {
	try {
		const raw = localStorage.getItem(EPISODE_KEY);
		const map = raw ? JSON.parse(raw) : {};
		const saved = map[episodeStorageKey(movie)];
		if (saved && Number.isInteger(saved.season) && Number.isInteger(saved.number)) {
			return { season: Math.max(1, saved.season), number: Math.max(1, saved.number) };
		}
	} catch (error) {
		logger.warn('Failed to read episode memory', error);
	}
	return { season: 1, number: 1 };
}

function saveEpisode() {
	if (!currentMovie || !currentEpisode) return;
	try {
		const raw = localStorage.getItem(EPISODE_KEY);
		const map = raw ? JSON.parse(raw) : {};
		map[episodeStorageKey(currentMovie)] = currentEpisode;
		localStorage.setItem(EPISODE_KEY, JSON.stringify(map));
	} catch (error) {
		logger.warn('Failed to save episode memory', error);
	}
}

function setEpisode(season, number) {
	if (currentMovie?.type !== 'series') return;
	currentEpisode = {
		season: Math.max(1, Math.trunc(season) || 1),
		number: Math.max(1, Math.trunc(number) || 1),
	};
	currentMovie = { ...currentMovie, episode: currentEpisode };
	saveEpisode();
	renderEpisodeBar();
	if (currentSource) selectSource(currentSource);
}

function renderEpisodeBar() {
	if (!episodeBarElement) return;
	const isSeries = currentMovie?.type === 'series';
	episodeBarElement.hidden = !isSeries;
	if (!isSeries || !currentEpisode) return;
	if (seasonLabelElement) seasonLabelElement.textContent = `Сезон ${currentEpisode.season}`;
	if (episodeLabelElement) episodeLabelElement.textContent = `Серия ${currentEpisode.number}`;
}

function fitPlayerFrame() {
	const frame = contentElement.querySelector('.frame');
	if (!frame) return;

	const episodeBar = (!episodeBarElement?.hidden && episodeBarElement?.offsetHeight) || 0;
	const chrome = (headerElement?.offsetHeight ?? 64) + (sourcesElement?.offsetHeight ?? 56) + episodeBar + 24;
	const availableHeight = Math.max(window.innerHeight - chrome - 12, 120);

	let width = contentElement.clientWidth || window.innerWidth;
	if (width / (16 / 9) > availableHeight) width = availableHeight * (16 / 9);

	frame.style.width = `${Math.floor(width)}px`;
}

function setTitle(title) {
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
	if (currentTheme === 'dynamic') {
		applyDynamicBackdrop(currentMovie?.cover);
	} else {
		clearDynamicBackdrop();
	}
}

let currentDynamicCover = '';
let dynamicMorphTimer = null;

function clearDynamicBackdrop() {
	const root = document.documentElement.style;
	root.removeProperty('--dynamic-cover');
	root.removeProperty('--dynamic-accent');
	root.removeProperty('--dynamic-glow');
	root.removeProperty('--dynamic-subtle');
	root.removeProperty('--dynamic-mid');
	currentDynamicCover = '';
	if (dynamicMorphTimer) {
		clearTimeout(dynamicMorphTimer);
		dynamicMorphTimer = null;
	}
	backgroundElement.classList.remove('morphing');
}

async function applyDynamicBackdrop(rawCover) {
	const resolved = resolveCoverUrl(rawCover || '');
	if (!resolved) {
		clearDynamicBackdrop();
		backgroundElement.classList.remove('visible');
		return;
	}

	if (resolved !== currentDynamicCover) {
		const changing = resolved !== '' && currentDynamicCover !== '';
		currentDynamicCover = resolved;
		if (changing) {

			backgroundElement.classList.add('morphing');
			if (dynamicMorphTimer) clearTimeout(dynamicMorphTimer);
			dynamicMorphTimer = setTimeout(() => {
				document.documentElement.style.setProperty('--dynamic-cover', `url("${resolved}")`);
				dynamicMorphTimer = setTimeout(() => backgroundElement.classList.remove('morphing'), MORPH_FADE);
			}, MORPH_FADE);
		} else {
			document.documentElement.style.setProperty('--dynamic-cover', `url("${resolved}")`);
		}
	}

	backgroundElement.classList.add('visible');

	try {
		const accent = await extractAccentFromImage(resolved);
		if (accent) {
			const rgb = hexToRgb(accent.rgb);
			document.documentElement.style.setProperty('--dynamic-accent', accent.rgb);
			if (rgb) {
				document.documentElement.style.setProperty('--dynamic-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`);
				document.documentElement.style.setProperty('--dynamic-subtle', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
				document.documentElement.style.setProperty('--dynamic-mid', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`);
			}
		}
	} catch (error) {
		logger.warn('Could not extract accent color', error);
	}
}

function hexToRgb(hex) {
	const match = hex.replace('#', '');
	if (match.length !== 6) return null;
	return {
		r: parseInt(match.slice(0, 2), 16),
		g: parseInt(match.slice(2, 4), 16),
		b: parseInt(match.slice(4, 6), 16),
	};
}

function rgbToHex(r, g, b) {
	const clamp = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
	return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function extractAccentFromImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const size = 64;
				const canvas = document.createElement('canvas');
				canvas.width = size;
				canvas.height = size;
				const ctx = canvas.getContext('2d', { willReadFrequently: true });
				ctx.drawImage(img, 0, 0, size, size);

				const data = ctx.getImageData(0, 0, size, size).data;
				const bucketSize = 24;
				const buckets = new Map();
				let maxCount = 0;
				let best = null;

				for (let i = 0; i < data.length; i += 4) {
					const r = data[i];
					const g = data[i + 1];
					const b = data[i + 2];
					const a = data[i + 3];
					if (a < 125) continue;

					const max = Math.max(r, g, b);
					const min = Math.min(r, g, b);
					if (max < 30 || min > 220) continue;

					const key = `${Math.floor(r / bucketSize)},${Math.floor(g / bucketSize)},${Math.floor(b / bucketSize)}`;
					const count = (buckets.get(key) || 0) + 1;
					buckets.set(key, count);
					if (count > maxCount) {
						maxCount = count;
						best = { r, g, b };
					}
				}

				resolve(best ? { rgb: rgbToHex(best.r, best.g, best.b) } : null);
			} catch (error) {
				reject(error);
			}
		};
		img.onerror = () => resolve(null);
		img.src = url;
	});
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

		option.appendChild(name);
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

function parseMovieData(data) {
	if (typeof data !== 'object' || data === null) {
		throw new Error(`Invalid movie data type: "${typeof data}"`);
	}

	const allowedKeys = [
		'imdb', 'tmdb', 'kinopoisk', 'title', 'cover', 'genre', 'year', 'type', 'sources',
		'rating', 'description', 'slogan', 'ageRating', 'countries', 'duration',
		'directors', 'actors', 'altTitle',
	];
	Object.keys(data).forEach((key) => {
		if (!allowedKeys.includes(key)) delete data[key];
	});

	return data;
}

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

function showPlayerText(messageText) {
	const playerTextElement = document.createElement('span');
	playerTextElement.textContent = messageText;
	playerTextElement.style.animation = 'fadeIn 0.3s ease both';

	contentElement.innerHTML = '';
	contentElement.appendChild(playerTextElement);
}

function sameMovie(a, b) {
	if (!a || !b) return false;
	if (a.kinopoisk && b.kinopoisk) return a.kinopoisk === b.kinopoisk;
	return a.title === b.title;
}

function saveWatchedMovie(movieData) {
	if (!movieData?.title) return;

	let watched = getWatchedMovies();
	const existing = watched.find((item) => sameMovie(item, movieData));
	watched = watched.filter((item) => !sameMovie(item, movieData));
	watched.unshift({
		kinopoisk: movieData.kinopoisk ?? '',
		type: movieData.type ?? 'movie',
		title: movieData.title,
		cover: movieData.cover || existing?.cover || '',
		genre: movieData.genre || existing?.genre || '',
		year: movieData.year || existing?.year || '',
		rating: movieData.rating || existing?.rating || '',
		description: movieData.description || existing?.description || '',
		slogan: movieData.slogan || existing?.slogan || '',
		ageRating: movieData.ageRating || existing?.ageRating || '',
		countries: movieData.countries || existing?.countries || '',
		duration: movieData.duration || existing?.duration || '',
		directors: movieData.directors || existing?.directors || '',
		actors: movieData.actors || existing?.actors || '',
		altTitle: movieData.altTitle || existing?.altTitle || '',
		timestamp: Date.now(),
	});

	try {
		localStorage.setItem(WATCHED_KEY, JSON.stringify(watched));
	} catch (error) {
		logger.warn('Failed to save watched list', error);
	}
}

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

function syncCurrentCover() {
	if (!currentMovie?.cover || !currentMovie?.title) return;

	let changed = false;
	const movies = getWatchedMovies().map((movie) => {
		if (!movie.cover && sameMovie(movie, currentMovie)) {
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

function deleteWatchedMovie(movie) {
	if (!movie) return;
	try {
		const movies = getWatchedMovies().filter((item) => !sameMovie(item, movie));
		localStorage.setItem(WATCHED_KEY, JSON.stringify(movies));
	} catch (error) {
		logger.warn('Failed to delete watched movie', error);
	}
	renderWatchedMovies();
}

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
		const item = document.createElement('div');
		item.className = 'watched-item';
		item.title = '';
		if (currentMovie && sameMovie(movie, currentMovie)) item.classList.add('selected');

		const coverBtn = document.createElement('button');
		coverBtn.type = 'button';
		coverBtn.className = 'cover-btn';
		coverBtn.title = 'Подробнее о фильме';
		coverBtn.setAttribute('aria-label', 'Подробнее о фильме');
		coverBtn.addEventListener('click', () => showMovieModal(movie));

		const cover = document.createElement('img');
		cover.className = 'cover';
		cover.alt = '';
		if (movie.cover) {
			cover.src = resolveCoverUrl(movie.cover);
			cover.addEventListener('error', () => {
				coverBtn.classList.add('no-cover');
				cover.style.display = 'none';
			});
		} else {
			coverBtn.classList.add('no-cover');
		}
		coverBtn.appendChild(cover);

		const info = document.createElement('button');
		info.type = 'button';
		info.className = 'info';
		info.title = 'Открыть в плеере';
		info.addEventListener('click', () => loadWatchedMovie(movie));

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

		const del = document.createElement('button');
		del.type = 'button';
		del.className = 'delete-btn';
		del.title = 'Удалить из списка';
		del.setAttribute('aria-label', 'Удалить из списка');
		del.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
		del.addEventListener('click', (event) => {
			event.stopPropagation();
			deleteWatchedMovie(movie);
		});

		item.appendChild(coverBtn);
		item.appendChild(info);
		item.appendChild(del);
		fragment.appendChild(item);
	});

	watchedListElement.appendChild(fragment);
}

async function fetchMovieDetails(movie) {
	const base = {
		kinopoisk: movie.kinopoisk ?? '',
		type: movie.type ?? '',
		title: movie.title ?? '',
		cover: movie.cover ?? '',
		genre: movie.genre ?? '',
		year: movie.year ?? '',
		description: movie.description ?? '',
		rating: movie.rating ?? '',
		ageRating: movie.ageRating ?? '',
		countries: movie.countries ?? '',
		directors: movie.directors ?? '',
		actors: movie.actors ?? '',
		duration: movie.duration ?? '',
		slogan: movie.slogan ?? '',
		altTitle: movie.altTitle ?? '',
	};

	if (
		base.title && base.cover && base.year &&
		base.description && base.rating && base.ageRating &&
		base.countries && base.duration && base.directors && base.actors
	) {
		return base;
	}

	if (!movie.kinopoisk) return base;

	const fill = (current, value) => (value ? value : current);
	const fromCache = async () => {
		try {
			if (typeof fetch !== 'function') return null;
			const res = await fetch(`/api/kp-info?id=${encodeURIComponent(movie.kinopoisk)}`);
			if (!res.ok) return null;
			const c = await res.json().catch(() => null);
			if (!c || typeof c !== 'object') return null;
			return {
				kinopoisk: base.kinopoisk || c.kinopoisk || '',
				type: base.type || c.type || '',
				title: fill(base.title, c.title),
				cover: fill(base.cover, c.cover),
				genre: fill(base.genre, c.genre),
				year: fill(base.year, c.year),
				description: fill(base.description, c.description),
				rating: fill(base.rating, c.rating),
				ageRating: fill(base.ageRating, c.ageRating),
				countries: fill(base.countries, c.countries),
				directors: fill(base.directors, c.directors),
				actors: fill(base.actors, c.actors),
				duration: fill(base.duration, c.duration),
				slogan: fill(base.slogan, c.slogan),
				altTitle: fill(base.altTitle, c.altTitle),
			};
		} catch {
			return null;
		}
	};

	return (await fromCache()) || base;
}

async function initFromKpId(kpId) {
	try {
		const movie = await fetchMovieDetails({ kinopoisk: kpId });
		if (!movie.title) {
			clearInitializationTimeout();
			showPlayerText('Не удалось получить данные о фильме. Откройте его страницу на Кинопоиске и нажмите «Смотреть».');
			return;
		}
		await init(movie);
	} catch (error) {
		clearInitializationTimeout();
		logger.error('Failed to load movie by id', error);
		showPlayerText('Не удалось загрузить фильм. Попробуйте ещё раз.');
	}
}

async function showMovieModal(movie) {
	closeMovieModal();

	const overlay = document.createElement('div');
	overlay.className = 'movie-modal-overlay';
	overlay.addEventListener('click', (event) => {
		if (event.target === overlay) closeMovieModal();
	});

	const modal = document.createElement('div');
	modal.className = 'movie-modal';
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-label', movie.title || 'Информация о фильме');

	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'modal-close';
	close.setAttribute('aria-label', 'Закрыть');
	close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
	close.addEventListener('click', closeMovieModal);
	modal.appendChild(close);

	const media = document.createElement('div');
	media.className = 'modal-media';
	const poster = document.createElement('img');
	poster.className = 'modal-poster';
	poster.alt = '';
	if (movie.cover) {
		poster.src = resolveCoverUrl(movie.cover);
		poster.addEventListener('error', () => poster.remove());
	}
	media.appendChild(poster);

	const body = document.createElement('div');
	body.className = 'modal-body';

	const title = document.createElement('h2');
	title.className = 'modal-title';
	title.textContent = movie.title || 'Без названия';
	body.appendChild(title);

	const altTitle = document.createElement('div');
	altTitle.className = 'modal-alt-title';
	altTitle.hidden = !movie.altTitle;
	altTitle.textContent = movie.altTitle || '';
	body.appendChild(altTitle);

	const headRow = document.createElement('div');
	headRow.className = 'modal-head-row';
	const ageBadge = document.createElement('span');
	ageBadge.className = 'modal-age';
	const ageText = formatAgeRating(movie.ageRating);
	ageBadge.textContent = ageText;
	ageBadge.hidden = !ageText;
	const year = document.createElement('span');
	year.className = 'modal-year';
	year.textContent = movie.year || '';
	headRow.appendChild(ageBadge);
	headRow.appendChild(year);
	headRow.hidden = !(ageText || movie.year);
	body.appendChild(headRow);

	const rating = document.createElement('div');
	rating.className = 'modal-rating';
	rating.hidden = !movie.rating;
	rating.textContent = movie.rating ? `Кинопоиск — ${movie.rating}` : '';
	body.appendChild(rating);

	const slogan = document.createElement('p');
	slogan.className = 'modal-slogan';
	slogan.hidden = !movie.slogan;
	slogan.textContent = movie.slogan || '';
	body.appendChild(slogan);

	const desc = document.createElement('p');
	desc.className = 'modal-desc';
	desc.hidden = !movie.description;
	desc.textContent = movie.description || '';
	body.appendChild(desc);

	const aboutTitle = document.createElement('h3');
	aboutTitle.className = 'modal-about-title';
	aboutTitle.textContent = movie.type === 'series' ? 'О сериале' : 'О фильме';
	aboutTitle.hidden = !(movie.countries || movie.genre || movie.directors || movie.actors || movie.duration);
	body.appendChild(aboutTitle);

	const about = document.createElement('dl');
	about.className = 'modal-about';
	appendAboutRow(about, 'Страна', movie.countries);
	appendAboutRow(about, 'Жанр', movie.genre);
	appendAboutRow(about, 'Режиссёр', movie.directors);
	appendAboutRow(about, 'Актёры', movie.actors);
	appendAboutRow(about, movie.type === 'series' ? 'Серия' : 'Время', movie.duration);
	body.appendChild(about);

	const remove = document.createElement('button');
	remove.type = 'button';
	remove.className = 'modal-remove';
	remove.title = 'Удалить из списка';
	remove.setAttribute('aria-label', 'Удалить из списка');
	remove.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	remove.addEventListener('click', () => {
		closeMovieModal();
		deleteWatchedMovie(movie);
	});
	modal.appendChild(remove);

	modal.appendChild(media);
	modal.appendChild(body);
	overlay.appendChild(modal);
	document.body.appendChild(overlay);

	const enriched = await fetchMovieDetails(movie);
	if (!document.body.contains(overlay)) return;

	if (enriched.title) title.textContent = enriched.title;
	altTitle.hidden = !enriched.altTitle;
	altTitle.textContent = enriched.altTitle || '';
	const newAge = formatAgeRating(enriched.ageRating);
	ageBadge.textContent = newAge;
	ageBadge.hidden = !newAge;
	year.textContent = enriched.year || '';
	headRow.hidden = !(newAge || enriched.year);
	if (enriched.rating) {
		rating.hidden = false;
		rating.textContent = `Кинопоиск — ${enriched.rating}`;
	}
	slogan.hidden = !enriched.slogan;
	slogan.textContent = enriched.slogan || '';
	desc.hidden = !enriched.description;
	desc.textContent = enriched.description || '';
	aboutTitle.hidden = !(enriched.countries || enriched.genre || enriched.directors || enriched.actors || enriched.duration);
	about.innerHTML = '';
	appendAboutRow(about, 'Страна', enriched.countries);
	appendAboutRow(about, 'Жанр', enriched.genre);
	appendAboutRow(about, 'Режиссёр', enriched.directors);
	appendAboutRow(about, 'Актёры', enriched.actors);
	appendAboutRow(about, movie.type === 'series' ? 'Серия' : 'Время', enriched.duration);
	if (enriched.cover && enriched.cover !== movie.cover) {
		poster.src = resolveCoverUrl(enriched.cover);
		poster.style.display = 'block';
	}
}

function appendAboutRow(list, label, value) {
	if (!value) return;
	const key = document.createElement('dt');
	key.className = 'modal-about-label';
	key.textContent = label;
	const val = document.createElement('dd');
	val.className = 'modal-about-value';
	val.textContent = value;
	list.appendChild(key);
	list.appendChild(val);
}

function formatAgeRating(value) {
	if (value === null || value === undefined || value === '') return '';
	const clean = String(value).replace(/[^\d]/g, '');
	return clean ? `${clean}+` : '';
}

function closeMovieModal() {
	document.querySelectorAll('.movie-modal-overlay').forEach((el) => el.remove());
}

function loadWatchedMovie(movie) {
	toggleSidebar(false);

	const { timestamp, ...rest } = movie;
	const data = { ...rest, type: movie.type === 'series' ? 'series' : 'movie' };

	logger.info('Loading watched movie', data);
	init(data);
}

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

		seasonPrevElement?.addEventListener('click', () => setEpisode((currentEpisode?.season ?? 1) - 1, 1));
		seasonNextElement?.addEventListener('click', () => setEpisode((currentEpisode?.season ?? 1) + 1, 1));
		episodePrevElement?.addEventListener('click', () => setEpisode(currentEpisode?.season ?? 1, (currentEpisode?.number ?? 1) - 1));
		episodeNextElement?.addEventListener('click', () => setEpisode(currentEpisode?.season ?? 1, (currentEpisode?.number ?? 1) + 1));
		episodeNextBtnElement?.addEventListener('click', () => setEpisode(currentEpisode?.season ?? 1, (currentEpisode?.number ?? 1) + 1));

		themeToggleElement?.addEventListener('click', () => {
			const willOpen = !themeSidebarElement?.classList.contains('open');
			toggleThemeSidebar(willOpen);
		});

		themeCloseElement?.addEventListener('click', () => toggleThemeSidebar(false));

		document.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				toggleSidebar(false);
				toggleThemeSidebar(false);
				closeMovieModal();
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

				}
			}

			if (parsed && typeof parsed === 'object' && typeof parsed.title === 'string') {
				logger.info('Movie data from URL:', parsed);
				init(parsed);
				return;
			}

			if (/^\d+$/.test(movieParam)) {
				logger.info('Movie id from URL:', movieParam);
				initFromKpId(movieParam);
				return;
			}

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
