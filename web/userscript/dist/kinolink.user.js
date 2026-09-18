// ==UserScript==
// @name         KinoLink by VOID
// @namespace    kinolink
// @version      2.0.5
// @author       VOID
// @description  KinoLink v2 — watch button for Kinopoisk, IMDb, TMDB, Letterboxd
// @downloadURL  https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/main/web/userscript/dist/kinolink.user.js
// @updateURL    https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/main/web/userscript/dist/kinolink.user.js
// @match        *://www.kinopoisk.ru/*
// @match        *://hd.kinopoisk.ru/*
// @match        *://*.imdb.com/title/*
// @match        *://www.themoviedb.org/movie/*
// @match        *://www.themoviedb.org/tv/*
// @match        *://letterboxd.com/film/*
// ==/UserScript==

(function() {
	"use strict";
	var VERSION = "2.0.5";
	function isDomain(host, domain) {
		return host === domain || host.endsWith(`.${domain}`);
	}
	function siteFor(host, path) {
		if (isDomain(host, "kinopoisk.ru")) return "kinopoisk";
		if (isDomain(host, "imdb.com") && path.startsWith("/title/tt")) return "imdb";
		if (isDomain(host, "themoviedb.org") && /^\/(movie|tv)\//.test(path)) return "tmdb";
		if (isDomain(host, "letterboxd.com") && path.startsWith("/film/")) return "letterboxd";
		return null;
	}
	function detectSite() {
		return siteFor(location.hostname, location.pathname);
	}
	function ogTitle() {
		return document.querySelector("meta[property=\"og:title\"]")?.getAttribute("content")?.trim() ?? "";
	}
	function coverFromMeta() {
		const read = (selector, attribute = "content") => document.querySelector(selector)?.getAttribute(attribute)?.trim() ?? "";
		return read("meta[property=\"og:image:secure_url\"]") || read("meta[property=\"og:image\"]") || read("meta[property=\"og:image:url\"]") || read("meta[name=\"twitter:image\"]") || read("meta[itemprop=\"image\"]") || read("link[rel=\"image_src\"]", "href");
	}
	function imageUrl(value) {
		if (typeof value === "string") return value;
		if (Array.isArray(value)) return imageUrl(value[0]);
		if (value && typeof value === "object") {
			const record = value;
			if (typeof record.url === "string") return record.url;
			if (typeof record.contentUrl === "string") return record.contentUrl;
		}
		return "";
	}
	function absoluteUrl(raw) {
		if (!raw) return "";
		try {
			const url = new URL(raw, location.href);
			return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
		} catch {
			return "";
		}
	}
	function kinopoiskPosterFromHtml() {
		const urls = (document.documentElement?.innerHTML ?? "").match(/https:\/\/avatars\.mds\.yandex\.net\/get-kinopoisk-image\/[^"'\\\s>]+/g) ?? [];
		for (const marker of [
			"600x900",
			"400x600",
			"300x450",
			"original"
		]) {
			const hit = urls.find((url) => url.includes(marker) && !url.includes(".webp"));
			if (hit) return hit;
		}
		return urls[0] ?? "";
	}
	function readJsonLd() {
		const info = {
			year: "",
			genre: "",
			image: ""
		};
		const visit = (node) => {
			if (Array.isArray(node)) {
				node.forEach(visit);
				return;
			}
			if (typeof node !== "object" || node === null) return;
			const record = node;
			if (!info.year && typeof record.datePublished === "string" && /^\d{4}/.test(record.datePublished)) info.year = record.datePublished.slice(0, 4);
			if (!info.genre && Array.isArray(record.genre)) info.genre = record.genre.filter((g) => typeof g === "string").join(", ");
			if (!info.image) info.image = imageUrl(record.image) || imageUrl(record.primaryImageOfPage);
			if (record["@graph"]) visit(record["@graph"]);
		};
		document.querySelectorAll("script[type=\"application/ld+json\"]").forEach((script) => {
			try {
				visit(JSON.parse(script.textContent ?? ""));
			} catch {}
		});
		return info;
	}
	function pageCover(jsonLdImage, scanHtml = false) {
		return absoluteUrl(jsonLdImage) || absoluteUrl(coverFromMeta()) || (scanHtml ? absoluteUrl(kinopoiskPosterFromHtml()) : "");
	}
	function extractKinopoisk() {
		const match = location.pathname.match(/^\/(film|series)\/(\d+)/);
		if (!match) return null;
		let title = ogTitle();
		if (!title || title.startsWith("Кинопоиск.")) return null;
		title = title.replace("— смотреть онлайн в хорошем качестве — Кинопоиск", "").trim();
		if (!title) return null;
		const ld = readJsonLd();
		return {
			kinopoisk: match[2],
			type: match[1] === "series" ? "series" : "movie",
			title,
			cover: pageCover(ld.image, true),
			year: ld.year,
			genre: ld.genre
		};
	}
	function extractImdb() {
		const fromUrl = location.pathname.match(/^\/title\/(tt\d+)/)?.[1];
		if (!fromUrl) return null;
		const seriesLink = document.querySelector("a[data-testid=\"hero-title-block__series-link\"]")?.getAttribute("href")?.match(/\/title\/(tt\d+)/)?.[1];
		let title = ogTitle();
		if (!title) return null;
		if (title.includes("⭐")) title = title.split("⭐")[0].trim();
		if (title.endsWith("- IMDb") && title.includes(")")) title = title.slice(0, title.lastIndexOf(")") + 1).trim();
		if (!title) return null;
		return {
			imdb: seriesLink ?? fromUrl,
			title,
			cover: pageCover(readJsonLd().image)
		};
	}
	function extractTmdb() {
		const match = location.pathname.match(/^\/(movie|tv)\/(\d+)/);
		if (!match) return null;
		const title = ogTitle();
		if (!title) return null;
		return {
			tmdb: match[2],
			type: match[1] === "tv" ? "series" : "movie",
			title,
			cover: pageCover(readJsonLd().image)
		};
	}
	function extractLetterboxd() {
		const title = ogTitle();
		if (!title) return null;
		const cover = pageCover(readJsonLd().image);
		const links = Array.from(document.querySelectorAll("a[href]"));
		const imdb = links.find((a) => /imdb\.com\/title\/tt\d+/.test(a.getAttribute("href") ?? ""))?.getAttribute("href")?.match(/\/title\/(tt\d+)/)?.[1];
		if (imdb) return {
			imdb,
			title,
			cover
		};
		const tmdb = links.find((a) => /themoviedb\.org\/(movie|tv)\/\d+/.test(a.getAttribute("href") ?? ""))?.getAttribute("href")?.match(/\/(?:movie|tv)\/(\d+)/)?.[1];
		if (tmdb) return {
			tmdb,
			title,
			cover
		};
		return null;
	}
	var extractors = {
		kinopoisk: extractKinopoisk,
		imdb: extractImdb,
		tmdb: extractTmdb,
		letterboxd: extractLetterboxd
	};
	var logger = {
		info: (...args) => console.info("[KinoLink]", ...args),
		warn: (...args) => console.warn("[KinoLink]", ...args),
		error: (...args) => console.error("[KinoLink]", ...args)
	};
	var BUTTON_ID = "kinolink-watch-button";
	var currentOnClick = () => {};
	function makeButton() {
		const btn = document.createElement("button");
		btn.id = BUTTON_ID;
		btn.type = "button";
		btn.title = "Смотреть через KinoLink";
		btn.addEventListener("click", () => currentOnClick());
		return btn;
	}
	function kinopoiskMobileActionRow() {
		const nodes = Array.from(document.querySelectorAll("button, a, span, div"));
		for (const node of nodes) if (node.children.length === 0 && node.textContent?.trim() === "Буду смотреть") return node.parentElement;
		return null;
	}
	function kinopoiskReferenceButton() {
		const found = Array.from(document.querySelectorAll("button")).find((el) => el.getAttribute("title") === "Буду смотреть");
		return found instanceof HTMLButtonElement ? found : null;
	}
	var KP_BUTTON_CLASSES = [
		"style_button__Awsrq",
		"style_buttonSize52__MBeHC",
		"style_buttonPrimary__Qn_9l",
		"style_buttonDark__pBW5l",
		"style_withIconLeft__USlpL"
	].join(" ");
	var KP_WRAPPER_CLASS = "styles_button__bW_ew";
	function injectBreathStyle() {
		if (document.getElementById("kinolink-breath")) return;
		const style = document.createElement("style");
		style.id = "kinolink-breath";
		style.textContent = [
			"@keyframes kinolink-breathe {",
			"  0%, 100% { box-shadow: 0 0 8px rgba(122, 47, 208, 0.35); }",
			"  50% { box-shadow: 0 0 20px rgba(122, 47, 208, 0.75); }",
			"}",
			`#${BUTTON_ID} { animation: kinolink-breathe 3s ease-in-out infinite; }`
		].join("\n");
		document.head.appendChild(style);
	}
	function playSvg(size, color) {
		return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="width:${size}px !important;height:${size}px !important;flex-shrink:0;display:block" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3.375 21 12 6 20.625V3.375Z" fill="${color}"/></svg>`;
	}
	function attachMainStyleButton(ref) {
		const btn = makeButton();
		const wrapper = document.createElement("div");
		wrapper.className = KP_WRAPPER_CLASS;
		wrapper.style.display = "inline-flex";
		wrapper.style.marginRight = "8px";
		btn.className = KP_BUTTON_CLASSES;
		btn.setAttribute("aria-pressed", "false");
		btn.style.setProperty("background", "linear-gradient(45deg, #2b0a45 0%, #000000 100%)", "important");
		btn.style.setProperty("background-color", "transparent", "important");
		const icon = document.createElement("span");
		icon.style.display = "flex";
		icon.style.alignItems = "center";
		icon.style.justifyContent = "center";
		icon.innerHTML = playSvg(24, "#ffffff");
		btn.appendChild(icon);
		btn.appendChild(document.createTextNode("Смотреть"));
		wrapper.appendChild(btn);
		ref.before(wrapper);
	}
	function attachImdbButton(hero) {
		const btn = makeButton();
		btn.style.cssText = [
			"display:inline-flex",
			"align-items:center",
			"gap:8px",
			"margin:12px 0",
			"padding:10px 20px",
			"font-size:15px",
			"font-weight:700",
			"color:#000",
			"background:#f5c518",
			"border:none",
			"border-radius:999px",
			"cursor:pointer"
		].join(";");
		btn.innerHTML = playSvg(18, "#000000");
		btn.appendChild(document.createTextNode("Смотреть"));
		hero.after(btn);
	}
	function attachTmdbButton(after) {
		const btn = makeButton();
		btn.style.cssText = [
			"display:inline-flex",
			"align-items:center",
			"gap:8px",
			"margin-left:12px",
			"padding:10px 20px",
			"font-size:15px",
			"font-weight:700",
			"color:#fff",
			"background:#1c2c44",
			"border:1px solid rgba(255,255,255,0.1)",
			"border-radius:999px",
			"cursor:pointer",
			"white-space:nowrap"
		].join(";");
		btn.innerHTML = playSvg(16, "currentColor");
		btn.appendChild(document.createTextNode("Смотреть"));
		after.after(btn);
	}
	function attachLetterboxdButton(details) {
		const btn = makeButton();
		btn.style.cssText = [
			"display:flex",
			"align-items:center",
			"justify-content:center",
			"gap:8px",
			"width:100%",
			"margin:12px 0",
			"padding:10px 16px",
			"font-size:14px",
			"font-weight:700",
			"color:#fff",
			"background:#00c030",
			"border:none",
			"border-radius:999px",
			"cursor:pointer"
		].join(";");
		btn.innerHTML = playSvg(16, "currentColor");
		btn.appendChild(document.createTextNode("Смотреть"));
		details.after(btn);
	}
	function attachMobileButton(after, mode) {
		const btn = makeButton();
		btn.style.cssText = [
			"display:flex",
			"align-items:center",
			"justify-content:center",
			"gap:8px",
			"width:100%",
			"min-height:48px",
			"margin:12px 0",
			"padding:12px 16px",
			"font-size:17px",
			"font-weight:700",
			"color:#fff",
			"background:linear-gradient(45deg, #2b0a45 0%, #000000 100%)",
			"border:1px solid #7a2fd0",
			"border-radius:12px",
			"cursor:pointer"
		].join(";");
		btn.innerHTML = playSvg(22, "#ffffff");
		btn.appendChild(document.createTextNode("Смотреть"));
		if (mode === "append") after.appendChild(btn);
		else after.after(btn);
	}
	function styleFallbackButton(btn, floating) {
		btn.textContent = "▶ Смотреть";
		btn.style.cssText = [
			"background:#2b0a45",
			"color:#fff",
			"border:1px solid #7a2fd0",
			"border-radius:8px",
			"padding:10px 16px",
			"font-size:15px",
			"font-weight:700",
			"cursor:pointer",
			"z-index:2147483647",
			...floating ? [
				"position:fixed",
				"right:16px",
				"bottom:16px",
				"box-shadow:0 4px 16px rgba(0,0,0,.5)"
			] : ["margin:8px 8px 8px 0"]
		].join(";");
	}
	function ensureButton(site, onClick) {
		if (document.getElementById("kinolink-watch-button")) return;
		currentOnClick = onClick;
		if (site === "kinopoisk") {
			injectBreathStyle();
			const ref = kinopoiskReferenceButton();
			if (ref) {
				attachMainStyleButton(ref);
				logger.info("kp anchor: desktop-ref");
				return;
			}
			const actions = kinopoiskMobileActionRow();
			if (actions) {
				attachMobileButton(actions, "after");
				logger.info("kp anchor: mobile-actions");
				return;
			}
			const title = document.querySelector("main h1, article h1, h1");
			if (title) {
				attachMobileButton(title, "after");
				logger.info("kp anchor: title-fallback");
				return;
			}
			logger.info("kp anchor: none");
		}
		if (site === "imdb") {
			const hero = document.querySelector("[data-testid=\"hero-title-block\"]");
			if (hero) {
				attachImdbButton(hero);
				logger.info("anchor: imdb-hero");
				return;
			}
		}
		if (site === "tmdb") {
			const vibe = document.querySelector("#vibes_label");
			if (vibe) {
				attachTmdbButton(vibe);
				logger.info("anchor: tmdb-vibe");
				return;
			}
			const actions = document.querySelector("ul.auto.actions");
			if (actions) {
				attachTmdbButton(actions);
				logger.info("anchor: tmdb-actions");
				return;
			}
		}
		if (site === "letterboxd") {
			const details = document.querySelector("section.production-masthead div.details, h1.headline-1");
			if (details) {
				attachLetterboxdButton(details);
				logger.info("anchor: lb-details");
				return;
			}
		}
		const btn = makeButton();
		logger.warn("no anchor for", site, "— using floating button");
		styleFallbackButton(btn, true);
		document.body.appendChild(btn);
	}
	var TITLE_MAX = 300;
	var DETAIL_MAX = 200;
	var COVER_MAX = 8192;
	var KINOPOISK_RE = /^\d{1,20}$/;
	var IMDB_RE = /^tt\d{1,20}$/;
	var TMDB_RE = /^\d{1,20}$/;
	function isRecord(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
	function cleanString(value) {
		return typeof value === "string" ? value.trim() : "";
	}
	function parseMovieRef(input) {
		if (!isRecord(input)) return null;
		const title = cleanString(input.title).slice(0, TITLE_MAX);
		if (!title) return null;
		const out = {
			title,
			type: "movie"
		};
		const kinopoisk = cleanString(input.kinopoisk);
		if (kinopoisk) {
			if (!KINOPOISK_RE.test(kinopoisk)) return null;
			out.kinopoisk = kinopoisk;
		}
		const imdb = cleanString(input.imdb);
		if (imdb) {
			if (!IMDB_RE.test(imdb)) return null;
			out.imdb = imdb;
		}
		const tmdb = cleanString(input.tmdb);
		if (tmdb) {
			if (!TMDB_RE.test(tmdb)) return null;
			out.tmdb = tmdb;
		}
		if (!out.kinopoisk && !out.imdb && !out.tmdb) return null;
		if (input.type === "series" || input.type === "movie") out.type = input.type;
		const cover = cleanString(input.cover);
		if (cover && cover.length <= COVER_MAX && (cover.startsWith("http://") || cover.startsWith("https://"))) out.cover = cover;
		const year = cleanString(input.year);
		if (/^\d{4}$/.test(year)) out.year = year;
		const genre = cleanString(input.genre).slice(0, DETAIL_MAX);
		if (genre) out.genre = genre;
		return out;
	}
	function bytesToB64Url(bytes) {
		let binary = "";
		for (const b of bytes) binary += String.fromCharCode(b);
		return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}
	var encoder = new TextEncoder();
	new TextDecoder();
	function encodeMovieRef(ref) {
		const valid = parseMovieRef(ref);
		if (!valid) throw new Error("invalid MovieRef");
		return bytesToB64Url(encoder.encode(JSON.stringify(valid)));
	}
	function buildPlayerQuery(ref, scriptVersion) {
		const params = new URLSearchParams();
		params.set("m", encodeMovieRef(ref));
		if (scriptVersion) params.set("v", scriptVersion);
		return `?${params.toString()}`;
	}
	var PLAYER_URL = "http://127.0.0.1:8080/";
	var PLAYER_OVERRIDE_KEY = "kinolink-player-url";
	function playerBase() {
		try {
			const override = localStorage.getItem(PLAYER_OVERRIDE_KEY);
			if (override) return override.endsWith("/") ? override : `${override}/`;
		} catch {}
		return PLAYER_URL;
	}
	function openPlayer(raw) {
		let url;
		try {
			url = buildPlayerUrl(playerBase(), raw, VERSION);
		} catch (error) {
			logger.error("refused to open player: invalid movie ref", raw, error);
			return;
		}
		logger.info("opening player", url);
		if (!window.open(url, "_blank")) window.location.assign(url);
	}
	function buildPlayerUrl(base, raw, scriptVersion) {
		const movie = parseMovieRef(raw);
		if (!movie) throw new Error("invalid MovieRef");
		return (base.endsWith("/") ? base : `${base}/`) + buildPlayerQuery(movie, scriptVersion);
	}
	var observer = null;
	var latest = null;
	var TICK_INTERVAL = 150;
	var tickTimer = null;
	function clearButton() {
		latest = null;
		document.getElementById(BUTTON_ID)?.remove();
	}
	function tick() {
		const site = detectSite();
		if (!site) {
			clearButton();
			return;
		}
		let raw = null;
		try {
			raw = extractors[site]();
		} catch (error) {
			logger.warn("extractor failed", error);
			return;
		}
		if (!raw) {
			clearButton();
			return;
		}
		latest = raw;
		ensureButton(site, () => {
			if (latest) openPlayer(latest);
		});
	}
	function scheduleTick() {
		if (tickTimer !== null) return;
		tickTimer = setTimeout(() => {
			tickTimer = null;
			tick();
		}, TICK_INTERVAL);
	}
	function init() {
		logger.info(`KinoLink userscript ${VERSION} started`);
		tick();
		observer?.disconnect();
		observer = new MutationObserver(() => scheduleTick());
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true
		});
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();
})();
