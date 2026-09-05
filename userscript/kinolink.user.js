// ==UserScript==
// @name         KinoLink by VOID
// @namespace    kinolink
// @version      0.7.2
// @description  light player for kinopoisk
// @author       V01D4GE
// @match        *://www.kinopoisk.ru/*
// @match        *://hd.kinopoisk.ru/*
// @icon         none
// @updateURL    https://raw.githubusercontent.com/Est-Void/KinoLink_by_VOID/main/userscript/kinolink.user.js
// @downloadURL  https://raw.githubusercontent.com/Est-Void/KinoLink_by_VOID/main/userscript/kinolink.user.js
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	const PLAYER_URL = 'http://127.0.0.1:8080/';
	// Автоопределение адреса сервера: если сервер поднялся не на 8080,
	// клиент сам найдёт его перебором портов через /api/status.
	const CUSTOM_SERVER_URL = ''; // явный адрес сервера, например 'http://192.168.1.5:8080/'
	const SERVER_DISCOVER_KEY = 'kinolink-server-url';
	const SERVER_DISCOVER_RANGE = { start: 8080, end: 8129 };
	const SERVER_MDNS_HOST = 'kinolink.local'; // локальный адрес сервера в сети (mDNS)
	const SCRIPT_VERSION = '0.7.2';

	const logger = {
		info: (...args) => console.info('[KinoLink Script]', ...args),
		warn: (...args) => console.warn('[KinoLink Script]', ...args),
		error: (...args) => console.error('[KinoLink Script]', ...args),
	};

	let playerUrlPromise = null;

	async function probeServer(base) {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 400);
			const response = await fetch(`${base}api/status`, { signal: controller.signal });
			clearTimeout(timer);
			if (!response.ok) return false;
			const data = await response.json();
			return Boolean(data && data.app === 'kinolink');
		} catch (error) {
			return false;
		}
	}

	async function discoverPlayerUrl() {
		if (CUSTOM_SERVER_URL) return CUSTOM_SERVER_URL;

		let cached = null;
		try {
			cached = localStorage.getItem(SERVER_DISCOVER_KEY);
		} catch (error) {
		}
		if (cached && (await probeServer(cached))) return cached;

		const scanHost = async (host) => {
			for (let port = SERVER_DISCOVER_RANGE.start; port <= SERVER_DISCOVER_RANGE.end; port++) {
				const candidate = `http://${host}:${port}/`;
				if (await probeServer(candidate)) {
					try {
						localStorage.setItem(SERVER_DISCOVER_KEY, candidate);
					} catch (error) {
					}
					return candidate;
				}
			}
			return null;
		};

		const local = await scanHost('127.0.0.1');
		if (local) return local;

		const mdns = await scanHost(SERVER_MDNS_HOST);
		if (mdns) return mdns;

		showServerSettings();
		return PLAYER_URL;
	}

	function showServerSettings() {
		if (settingsShown) return;
		settingsShown = true;

		const overlay = document.createElement('div');
		overlay.style.cssText =
			'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;background:#18181b;color:#fff;border:1px solid #3f3f46;border-radius:12px;padding:16px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)';

		const title = document.createElement('div');
		title.textContent = 'KinoLink: сервер не найден';
		title.style.cssText = 'font-weight:700;margin-bottom:8px';
		overlay.appendChild(title);

		const hint = document.createElement('div');
		hint.textContent =
			'Введите адрес сервера (он показан в консоли компьютера при запуске сервера), например http://192.168.0.28:8080/. Кнопка «Смотреть» заработает после сохранения.';
		hint.style.cssText = 'font-size:12px;color:#a1a1aa;margin-bottom:8px';
		overlay.appendChild(hint);

		const input = document.createElement('input');
		input.type = 'text';
		input.placeholder = 'http://192.168.0.28:8080/';
		input.style.cssText =
			'width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #3f3f46;background:#27272a;color:#fff;font:inherit;margin-bottom:8px';
		overlay.appendChild(input);

		const status = document.createElement('div');
		status.style.cssText = 'font-size:12px;color:#a1a1aa;margin-bottom:8px';
		overlay.appendChild(status);

		const save = document.createElement('button');
		save.type = 'button';
		save.textContent = 'Сохранить';
		save.style.cssText =
			'padding:8px 14px;border:0;border-radius:8px;background:linear-gradient(45deg,#2b0a45,#000);color:#fff;cursor:pointer;font-weight:600;margin-right:8px';
		overlay.appendChild(save);

		const close = document.createElement('button');
		close.type = 'button';
		close.textContent = 'Закрыть';
		close.style.cssText =
			'padding:8px 14px;border:1px solid #3f3f46;border-radius:8px;background:transparent;color:#a1a1aa;cursor:pointer';
		overlay.appendChild(close);

		save.addEventListener('click', async () => {
			const raw = (input.value || '').trim();
			if (!/^https?:\/\/.+/i.test(raw)) {
				status.textContent = 'Некорректный адрес';
				return;
			}
			const value = raw.replace(/\/+$/, '') + '/';
			status.textContent = 'Проверяю…';
			const ok = await probeServer(value);
			if (!ok) {
				status.textContent = 'Сервер не отвечает по этому адресу';
				return;
			}
			try {
				localStorage.setItem(SERVER_DISCOVER_KEY, value);
			} catch (error) {
			}
			playerUrlPromise = null;
			status.textContent = 'Сохранено. Нажмите «Смотреть» ещё раз.';
			logger.info('Server URL saved:', value);
		});

		close.addEventListener('click', () => overlay.remove());
		document.documentElement.appendChild(overlay);
	}

	function resolvePlayerUrl() {
		if (!playerUrlPromise) {
			playerUrlPromise = discoverPlayerUrl().then((url) => url);
		}
		return playerUrlPromise;
	}

	let observer = null;
	let settingsShown = false;

	console.info(`[KinoLink Script] KinoLink by VOID v${SCRIPT_VERSION} started`);

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
		const base = await resolvePlayerUrl();
		logger.info('Player server:', base);
		await cacheDetails(data);
		const query = data.kinopoisk
			? `?movie=${data.kinopoisk}`
			: `?movie=${encodeURIComponent(JSON.stringify(data))}`;
		window.open(`${base}${query}`, '_blank');
	}

	async function cacheDetails(data) {
		if (!data?.kinopoisk) return false;
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
			const response = await fetch(`${base}api/kp-info?id=${encodeURIComponent(data.kinopoisk)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			}).catch(() => null);
			return Boolean(response && response.ok);
		} catch (error) {
			return false;
		}
	}

	function cleanup() {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
	}

	function init() {
		ensureWatchButton();

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
