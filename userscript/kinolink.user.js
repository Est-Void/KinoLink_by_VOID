// ==UserScript==
// @name         KinoLink by VOID
// @namespace    kinolink
// @version      0.4.5
// @description  light player for kinopoisk
// @author       V01D4GE
// @match        *://www.kinopoisk.ru/*
// @icon         none
// @grant        none
// ==/UserScript==


(function () {
	'use strict';

	const PLAYER_URL = 'http://localhost:8080/';

	const logger = {
		info: (...args) => console.info('[KinoLink Script]', ...args),
		warn: (...args) => console.warn('[KinoLink Script]', ...args),
		error: (...args) => console.error('[KinoLink Script]', ...args),
	};

	let observer = null;

	// Print once so it's easy to verify in the console which version is running
	console.info('[KinoLink Script] KinoLink by VOID v0.4.4 started');

	/**
	 * Ensure our "Смотреть" button is attached to the left of "Буду смотреть".
	 * Runs on every DOM mutation. Re-adds the button if it has been removed
	 * by Kinopoisk re-rendering.
	 */
	function ensureWatchButton() {
		const watchLaterWrapper = findWatchLaterWrapper();
		if (document.getElementById('kinolink-watch-button')) return;
		if (!watchLaterWrapper) return;

		const watchButton = createWatchButton();
		watchLaterWrapper.before(watchButton);
		logger.info('Watch button attached');
	}

	/**
	 * Find the outer wrapper of the "Буду смотреть" button.
	 * @returns {HTMLElement | null}
	 */
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

	/**
	 * Create the "Смотреть" button. Styling lives in injected CSS targeting
	 * our own id (no inline !important overrides fighting Kinopoisk).
	 * @returns {HTMLDivElement}
	 */
	function createWatchButton() {
		const wrapper = document.createElement('div');
		wrapper.className = 'kinolink-watch-wrapper';

		const button = document.createElement('button');
		button.id = 'kinolink-watch-button';
		button.type = 'button';
		button.title = 'Смотреть';
		button.addEventListener('click', openPlayer);

		const icon = document.createElement('span');
		icon.className = 'kinolink-watch-icon';
		icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3.375 21 12 6 20.625V3.375Z" fill="currentColor"/></svg>';

		button.appendChild(icon);
		button.appendChild(document.createTextNode('Смотреть'));

		wrapper.appendChild(button);
		return wrapper;
	}

	/**
	 * Inject the button styles as a scoped <style> block. Targets only our id,
	 * so the native Kinopoisk styles stay untouched.
	 */
	function injectStyles() {
		const style = document.createElement('style');
		style.textContent = `
			#kinolink-watch-button {
				display: inline-flex;
				align-items: center;
				gap: 0.5rem;
				height: 40px;
				padding: 0 1.125rem;
				border: 1px solid rgba(224, 122, 0, 0.55);
				border-radius: 12px;
				background: rgba(15, 15, 15, 0.55);
				color: #ffffff;
				font: 500 0.95rem/1 var(--font-sans, sans-serif);
				cursor: pointer;
				transition: background-color 0.15s ease, border-color 0.15s ease;
			}
			#kinolink-watch-button:hover {
				background: rgba(224, 122, 0, 0.28);
				border-color: #e07a00;
			}
			#kinolink-watch-button:focus-visible {
				outline: 2px solid rgba(224, 122, 0, 0.6);
				outline-offset: 2px;
			}
			#kinolink-watch-button .kinolink-watch-icon {
				display: inline-flex;
				align-items: center;
				justify-content: center;
			}
			.kinolink-watch-wrapper {
				margin-right: 8px;
			}
		`;
		document.head.appendChild(style);
	}

	/**
	 * Extract movie data from the page: kinopoisk id, type, title, cover,
	 * genre and year (from og tags + embedded JSON-LD).
	 * @returns {{ kinopoisk: string, type: 'movie' | 'series', title: string, cover: string, genre: string, year: string } | null}
	 */
	function extractMovieData() {
		const path = location.pathname;
		const match = path.match(/^\/(film|series)\/(\d+)(\/|$)/);
		if (!match) return null;

		const type = match[1] === 'series' ? 'series' : 'movie';

		let title = document.querySelector('meta[property="og:title"]')?.content?.trim();
		if (!title) return null;
		if (title.startsWith('Кинопоиск.')) return null;
		title = title.replace('— смотреть онлайн в хорошем качестве — Кинопоиск', '').trim();

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

		// Parse embedded JSON-LD. Kinopoisk embeds several scripts (breadcrumbs,
		// the site, the film); scan all of them and take poster/genre/year from
		// the film entity.
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
				// Skip malformed JSON-LD blocks
			}
		}

		// Ultimate fallback: grab the first Kinopoisk poster URL referenced in
		// the page markup (og/JSON-LD are not always present).
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

		return { kinopoisk: match[2], type, title, cover: poster, genre, year };
	}

/**
 * Open the player with the extracted data. The player itself queries the
 * Kinobox-compatible sources (see KINOBOX_API_ENDPOINTS) — CORS `*` — so
 * nothing here needs to be fetched ahead of time and the button opens
 * instantly.
 */
function openPlayer() {
	const data = extractMovieData();
	if (!data) return logger.error('Failed to extract movie data');

	logger.info('Opening player for movie', data);
	window.open(`${PLAYER_URL}?movie=${encodeURIComponent(JSON.stringify(data))}`, '_blank');
}

	function cleanup() {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
	}

	/**
	 * Initialize the script
	 */
	function init() {
		injectStyles();
		ensureWatchButton();

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