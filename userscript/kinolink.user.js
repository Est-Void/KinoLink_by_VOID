// ==UserScript==
// @name         KinoLink by VOID
// @namespace    kinolink
// @version      0.8.3-dev
// @description  light player for kinopoisk
// @author       V01D4GE
// @match        *://www.kinopoisk.ru/*
// @match        *://hd.kinopoisk.ru/*
// @icon         none
// @updateURL    https://github.com/Est-Void/KinoLink_by_VOID/raw/dev/userscript/kinolink.user.js
// @downloadURL  https://github.com/Est-Void/KinoLink_by_VOID/raw/dev/userscript/kinolink.user.js
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	const PLAYER_URL = 'http://127.0.0.1:8080/';
	// Версия скрипта для проверки актуальности в плеере.
	// Синхронизируй с @version выше и REQUIRED_SCRIPT_VERSION в player/config.js.
	const SCRIPT_VERSION = '0.8.3-dev';
	// Автоопределение адреса сервера: если сервер поднялся не на 8080,
	// клиент сам найдёт его перебором портов через /api/status.
	const CUSTOM_SERVER_URL = ''; // адрес одного сервера, например 'http://192.168.1.5:8080/'
	// Известные серверы в локальной сети. Добавь сюда адрес, выведенный командой
	// `python3 player/server.py --lan`; доступные адреса проверяются автоматически.
	const NETWORK_SERVER_URLS = []; // например ['http://192.168.1.5:8080/']
	const SERVER_DISCOVER_KEY = 'kinolink-server-url';
	const SERVER_DISCOVER_RANGE = { start: 8080, end: 8129 };
	const SERVER_PROBE_TIMEOUT = 750;

	const logger = {
		info: (...args) => console.info('[KinoLink Script]', ...args),
		warn: (...args) => console.warn('[KinoLink Script]', ...args),
		error: (...args) => console.error('[KinoLink Script]', ...args),
	};

	let playerUrlPromise = null;
	let resolvedPlayerUrl = null;

	async function probeServer(base) {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT);
			const response = await fetch(new URL('api/status', base), { signal: controller.signal });
			clearTimeout(timer);
			if (!response.ok) return false;
			const data = await response.json();
			return Boolean(data && data.app === 'kinolink');
		} catch (error) {
			return false;
		}
	}

	function normalizeServerUrl(value) {
		try {
			const url = new URL(value);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
			url.pathname = '/';
			url.search = '';
			url.hash = '';
			return url.href;
		} catch (error) {
			logger.warn('Invalid KinoLink server URL', value);
			return '';
		}
	}

	async function findAvailableServer(candidates, parallelism = 1) {
		for (let offset = 0; offset < candidates.length; offset += parallelism) {
			const batch = candidates.slice(offset, offset + parallelism);
			const results = await Promise.all(batch.map(async (candidate) => (await probeServer(candidate)) ? candidate : ''));
			const found = results.find(Boolean);
			if (found) return found;
		}
		return '';
	}

	function rememberServerUrl(url) {
		try {
			localStorage.setItem(SERVER_DISCOVER_KEY, url);
		} catch (error) {
			logger.warn('Failed to remember KinoLink server URL', error);
		}
	}

	function getStoredServerUrl() {
		try {
			return normalizeServerUrl(localStorage.getItem(SERVER_DISCOVER_KEY) || '');
		} catch (error) {
			return '';
		}
	}

	function isLoopbackUrl(url) {
		try {
			return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
		} catch (error) {
			return false;
		}
	}

	function isMobileBrowser() {
		return Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
	}

	async function discoverPlayerUrl() {
		const custom = normalizeServerUrl(CUSTOM_SERVER_URL);
		if (custom) return custom;

		const cached = getStoredServerUrl();
		const knownServers = [cached, ...NETWORK_SERVER_URLS]
			.map(normalizeServerUrl)
			.filter((url, index, all) => url && all.indexOf(url) === index);
		const networkServer = await findAvailableServer(knownServers);
		if (networkServer) {
			rememberServerUrl(networkServer);
			return networkServer;
		}

		const localCandidates = [];
		for (let port = SERVER_DISCOVER_RANGE.start; port <= SERVER_DISCOVER_RANGE.end; port++) {
			localCandidates.push(`http://127.0.0.1:${port}/`);
		}
		const localServer = await findAvailableServer(localCandidates, 8);
		if (localServer) {
			rememberServerUrl(localServer);
			return localServer;
		}
		return '';
	}

	function resolvePlayerUrl() {
		if (!playerUrlPromise) {
			playerUrlPromise = discoverPlayerUrl().then((url) => {
				resolvedPlayerUrl = url;
				return url;
			});
		}
		return playerUrlPromise;
	}

	function askForServerUrl() {
		const value = window.prompt(
			'Введите адрес KinoLink на ноутбуке (например, http://192.168.1.5:8080). Оставьте пустым для поиска локального сервера:',
			'',
		);
		const url = normalizeServerUrl(value || '');
		if (url) rememberServerUrl(url);
		return url;
	}

	let observer = null;

	console.info('[KinoLink Script] KinoLink by VOID v0.8.3-dev started');

	function ensureWatchButton() {
		const watchLaterWrapper = findWatchLaterWrapper();
		if (document.getElementById('kinolink-watch-button')) return;
		if (!watchLaterWrapper) return;

		const watchButton = createWatchButton();
		watchLaterWrapper.before(watchButton);
		logger.info('Watch button attached');
	}

	function findWatchLaterWrapper() {
		const button = Array.from(document.querySelectorAll('button')).find(
			(el) => el.getAttribute('title') === 'Буду смотреть' && el.textContent.includes('Буду смотреть')
		);

		if (button) {
			let wrapper = button.parentElement;
			while (wrapper) {
				if (wrapper.className && String(wrapper.className).includes('styles_button__')) return wrapper;
				wrapper = wrapper.parentElement;
			}
			return button.parentElement || button;
		}

		const anchor = document.querySelector('a.styles_filmsToWatchButton');
		return anchor ? anchor.parentElement : null;
	}

	function createWatchButton() {
		const wrapper = document.createElement('div');
		wrapper.className = 'styles_button__bW_ew';
		wrapper.style.marginRight = '8px';

		const button = document.createElement('button');
		button.id = 'kinolink-watch-button';
		button.type = 'button';
		button.className = 'style_button__Awsrq style_buttonSize52__MBeHC style_buttonPrimary__Qn_9l style_buttonDark__pBW5l style_withIconLeft__USlpL';
		button.setAttribute('aria-pressed', 'false');
		button.title = 'Смотреть';
		button.addEventListener('click', openPlayer);

		button.style.setProperty('background', 'linear-gradient(45deg, #2b0a45 0%, #000000 100%)', 'important');
		button.style.setProperty('background-color', 'transparent', 'important');

		const icon = document.createElement('span');
		icon.className = 'style_iconLeft__9qY8j';
		icon.style.display = 'flex';
		icon.style.alignItems = 'center';
		icon.style.justifyContent = 'center';
		icon.innerHTML = '<svg width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3.375 21 12 6 20.625V3.375Z" fill="#ffffff"/></svg>';

		button.appendChild(icon);
		button.appendChild(document.createTextNode('Смотреть'));

		wrapper.appendChild(button);
		return wrapper;
	}

	function scrapePageDetails() {
		const text = (node) => (node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '');

		const fact = (name) => {
			const el = document.querySelector(`div[data-test-id="${name}"]`);
			if (!el) return '';
			const children = el.children;
			return text(children[children.length - 1]);
		};

		const ratingNode = document.querySelector(
			'.film-rating-value, [data-test-id="rating-value"], [data-test-id="rating"], .styles_ratingValue__qHpfi',
		);
		const ratingMatch = text(ratingNode).match(/^([\d.,]+)/);
		const rating = ratingMatch ? ratingMatch[1].replace(',', '.') : '';

		const age = fact('ageLimit') || fact('age') || '';
		const ageMatch = String(age).match(/(\d{1,2})\+/);
		const ageRating = ageMatch ? ageMatch[1] : '';

		const countries = fact('countries');
		const duration = fact('duration');
		const slogan = fact('tagline');

		const persons = (role) => {
			const el = document.querySelector(`[data-test-id="${role}"]`);
			const names = el ? Array.from(el.querySelectorAll('a')).map((a) => text(a)).filter(Boolean) : [];
			return names.join(', ');
		};
		const directors = persons('director') || fact('directors');
		const actors = persons('actors') || fact('actors') || fact('actor');

		const altTitle = text(
			document.querySelector('span.styles_originalTitle__nZWQK, span.styles_originalTitle__wJYdQ, [data-test-id="original-title"]'),
		);

		const descriptionNode = document.querySelector(
			'.styles_paragraph__V0fA2, [data-test-id="description"], .styles_paragraph__bpa54, p[itemprop="description"]',
		);
		let description = text(descriptionNode);
		if (!description) {
			const metaDesc = document.querySelector('meta[property="og:description"]')?.content?.trim();
			const metaClr = document.querySelector('meta[name="description"]')?.content?.trim();
			description = metaDesc || metaClr || '';
		}

		return {
			rating,
			description,
			slogan,
			ageRating,
			countries,
			duration,
			directors,
			actors,
			altTitle,
		};
	}

	function extractMovieData() {
		const path = location.pathname;
		const match = path.match(/^\/(film|series)\/(\d+)(\/|$)/);
		if (!match) return null;

		const type = match[1] === 'series' ? 'series' : 'movie';

		let title = document.querySelector('meta[property="og:title"]')?.content?.trim();
		if (!title) return null;
		if (title.startsWith('Кинопоиск.')) return null;
		title = title.replace('— смотреть онлайн в хорошем качестве — Кинопоиск', '').trim();

		let altFromTitle = '';
		const parenMatch = title.match(/\s*\(([^()]*\d{4}[^()]*)\)\s*$/);
		if (parenMatch && title.includes(',') && /\)\s*$/.test(title)) {
			altFromTitle = parenMatch[1];
			title = title.replace(/\s*\(([^()]*\d{4}[^()]*)\)\s*$/, '').trim();
		}

		const pageCover = (() => {
			const read = (selector, attribute) => document.querySelector(selector)?.getAttribute?.(attribute)?.trim?.();
			const readContent = (selector) => document.querySelector(selector)?.content?.trim?.();

			return (
				readContent('meta[property="og:image:secure_url"]') ||
				readContent('meta[property="og:image"]') ||
				readContent('meta[property="og:image:url"]') ||
				readContent('meta[name="twitter:image"]') ||
				readContent('meta[itemprop="image"]') ||
				read('link[rel="image_src"]', 'href') ||
				''
			);
		})();

		const imageOf = (value) => {
			if (typeof value === 'string') return value;
			if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
			if (value && typeof value === 'object') {
				if (typeof value.contentUrl === 'string') return value.contentUrl;
				if (typeof value.url === 'string') return value.url;
			}
			return '';
		};

		let genre = '';
		let year = '';
		let jsonPoster = '';
		const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
		for (const script of ldScripts) {
			try {
				const parseNode = (node) => {
					if (typeof node !== 'object' || node === null) return;
					if (Array.isArray(node)) {
						node.forEach(parseNode);
						return;
					}
					if (!jsonPoster) jsonPoster = imageOf(node.image) || imageOf(node.primaryImageOfPage);
					if (!genre && Array.isArray(node.genre)) genre = node.genre.filter(Boolean).join(', ');
					if (!year && typeof node.datePublished === 'string' && /^\d{4}/.test(node.datePublished)) {
						year = String(node.datePublished).slice(0, 4);
					}
					if (node['@graph']) parseNode(node['@graph']);
				};
				const data = JSON.parse(script.textContent);
				parseNode(data);
			} catch (error) {
			}
		}

		const posterFromHtml = () => {
			if (typeof document.documentElement?.innerHTML !== 'string') return '';
			const urls =
				document.documentElement.innerHTML.match(
					/https:\/\/avatars\.mds\.yandex\.net\/get-kinopoisk-image\/[^"'\\\s>]+/g,
				) || [];
			if (urls.length === 0) return '';
			const preferred = ['600x900', '400x600', '300x450', 'original'];
			for (const marker of preferred) {
				const hit = urls.find((url) => url.includes(marker) && !url.includes('.webp'));
				if (hit) return hit;
			}
			return urls[0];
		};

		const poster = jsonPoster || pageCover || posterFromHtml();

		const details = scrapePageDetails();

		return {
			kinopoisk: match[2],
			type,
			title,
			cover: poster,
			genre,
			year,
			...details,
			altTitle: altFromTitle || details.altTitle,
		};
	}

	async function openPlayer() {
		const data = extractMovieData();
		if (!data) return logger.error('Failed to extract movie data');

		logger.info('Opening player for movie', data);
		// На десктопе резервируем окно синхронно с кликом, иначе браузер может
		// принять его за popup после поиска. На мобильном ждём введённый адрес:
		// это не оставляет пользователя на about:blank.
		const mobile = isMobileBrowser();
		const playerWindow = mobile ? null : window.open('', '_blank');
		const custom = normalizeServerUrl(CUSTOM_SERVER_URL);
		const stored = getStoredServerUrl();
		const reusable = custom || (mobile && !isLoopbackUrl(stored) ? stored : '');
		let base = reusable;
		if (!base && mobile) base = askForServerUrl();
		if (!base) base = await resolvePlayerUrl();
		if (!base && !mobile) base = askForServerUrl();
		if (!base) {
			playerWindow?.close();
			window.alert('Не удалось выбрать сервер KinoLink. Проверьте Wi‑Fi и адрес сервера.');
			return;
		}
		resolvedPlayerUrl = base;
		playerUrlPromise = Promise.resolve(base);
		if (data.kinopoisk) cacheDetails(data);
		// Передаём данные целиком: плеер сразу получает title/cover без
		// ожидания фонового POST (см. cacheDetails) и гонок с кэшем.
		// SCRIPT_VERSION позволяет плееру заметить устаревший скрипт.
		const query = `?movie=${encodeURIComponent(JSON.stringify(data))}&script=${encodeURIComponent(SCRIPT_VERSION)}`;
		const playerUrl = `${base}${query}`;
		if (playerWindow) playerWindow.location.replace(playerUrl);
		else window.open(playerUrl, '_blank');
	}

	async function cacheDetails(data) {
		if (!data?.kinopoisk || !data?.title) return false;
		if (typeof fetch !== 'function') return false;
		try {
			const base = await resolvePlayerUrl();
			const payload = {
				title: data.title || '',
				type: data.type || '',
				cover: data.cover || '',
				genre: data.genre || '',
				year: data.year || '',
				rating: data.rating || '',
				description: data.description || '',
				slogan: data.slogan || '',
				ageRating: data.ageRating || '',
				countries: data.countries || '',
				duration: data.duration || '',
				directors: data.directors || '',
				actors: data.actors || '',
				altTitle: data.altTitle || '',
			};
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const response = await fetch(`${base}api/kp-info?id=${encodeURIComponent(data.kinopoisk)}`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(payload),
					});
					if (response.ok) {
						logger.info('Details cached for movie', data.kinopoisk);
						return true;
					}
				} catch (error) {
				}
				if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
			}
			logger.warn('Failed to cache details for movie', data.kinopoisk, 'server:', base);
		} catch (error) {
			logger.warn('cacheDetails error', error);
		}
		return false;
	}

	function cleanup() {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
	}

	function init() {
		ensureWatchButton();
		resolvePlayerUrl();

		const data = extractMovieData();
		if (data) cacheDetails(data);

		observer = new MutationObserver(() => {
			requestAnimationFrame(ensureWatchButton);
		});
		observer.observe(document.documentElement, { subtree: true, childList: true });

		window.addEventListener('beforeunload', cleanup);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
