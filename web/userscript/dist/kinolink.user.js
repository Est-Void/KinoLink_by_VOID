// ==UserScript==
// @name         KinoLink by VOID
// @namespace    kinolink
// @version      2.0.0-dev
// @author       VOID
// @description  KinoLink v2 — watch button for Kinopoisk, IMDb, TMDB, Letterboxd
// @downloadURL  https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/rewrite/v2/web/userscript/dist/kinolink.user.js
// @updateURL    https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/rewrite/v2/web/userscript/dist/kinolink.user.js
// @match        *://www.kinopoisk.ru/*
// @match        *://hd.kinopoisk.ru/*
// @match        *://*.imdb.com/title/*
// @match        *://www.themoviedb.org/movie/*
// @match        *://www.themoviedb.org/tv/*
// @match        *://letterboxd.com/film/*
// ==/UserScript==

(function() {
	"use strict";
	var VERSION = "2.0.0-dev";
	function detectSite() {
		const host = location.hostname;
		const path = location.pathname;
		if (host.endsWith("kinopoisk.ru")) return "kinopoisk";
		if (host.endsWith("imdb.com") && path.startsWith("/title/tt")) return "imdb";
		if (host.endsWith("themoviedb.org") && /^\/(movie|tv)\//.test(path)) return "tmdb";
		if (host.endsWith("letterboxd.com") && path.startsWith("/film/")) return "letterboxd";
		return null;
	}
	function ogTitle() {
		return document.querySelector("meta[property=\"og:title\"]")?.getAttribute("content")?.trim() ?? "";
	}
	function extractKinopoisk() {
		const match = location.pathname.match(/^\/(film|series)\/(\d+)/);
		if (!match) return null;
		let title = ogTitle();
		if (!title || title.startsWith("Кинопоиск.")) return null;
		title = title.replace("— смотреть онлайн в хорошем качестве — Кинопоиск", "").trim();
		if (!title) return null;
		return {
			kinopoisk: match[2],
			type: match[1] === "series" ? "series" : "movie",
			title
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
			title
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
			title
		};
	}
	function extractLetterboxd() {
		const title = ogTitle();
		if (!title) return null;
		const links = Array.from(document.querySelectorAll("a[href]"));
		const imdb = links.find((a) => /imdb\.com\/title\/tt\d+/.test(a.getAttribute("href") ?? ""))?.getAttribute("href")?.match(/\/title\/(tt\d+)/)?.[1];
		if (imdb) return {
			imdb,
			title
		};
		const tmdb = links.find((a) => /themoviedb\.org\/(movie|tv)\/\d+/.test(a.getAttribute("href") ?? ""))?.getAttribute("href")?.match(/\/(?:movie|tv)\/(\d+)/)?.[1];
		if (tmdb) return {
			tmdb,
			title
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
	function kinopoiskAnchor() {
		return Array.from(document.querySelectorAll("button")).find((el) => el.getAttribute("title") === "Буду смотреть")?.parentElement ?? null;
	}
	function findAnchor(site) {
		switch (site) {
			case "kinopoisk": {
				const anchor = kinopoiskAnchor();
				return anchor ? {
					parent: anchor,
					mode: "before"
				} : null;
			}
			case "imdb": {
				const hero = document.querySelector("[data-testid=\"hero-title-block\"]");
				return hero ? {
					parent: hero,
					mode: "after"
				} : null;
			}
			case "tmdb": {
				const title = document.querySelector(".header .title, .title");
				return title ? {
					parent: title,
					mode: "after"
				} : null;
			}
			case "letterboxd": {
				const title = document.querySelector(".film-title-wrapper") ?? document.querySelector("h1.headline-1");
				return title ? {
					parent: title,
					mode: "after"
				} : null;
			}
		}
	}
	function styleButton(btn, floating) {
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
		const btn = document.createElement("button");
		btn.id = BUTTON_ID;
		btn.type = "button";
		btn.textContent = "▶ Смотреть";
		btn.title = "Смотреть через KinoLink";
		btn.addEventListener("click", onClick);
		const anchor = findAnchor(site);
		if (!anchor) {
			logger.warn("no anchor for", site, "— using floating button");
			styleButton(btn, true);
			document.body.appendChild(btn);
			return;
		}
		styleButton(btn, false);
		if (anchor.mode === "before") anchor.parent.before(btn);
		else if (anchor.mode === "after") anchor.parent.after(btn);
		else anchor.parent.appendChild(btn);
		logger.info("button attached", site);
	}
	var TITLE_MAX = 300;
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
	var PLAYER_URL = "https://example.com/";
	var PLAYER_OVERRIDE_KEY = "kinolink-player-url";
	function playerBase() {
		try {
			const override = localStorage.getItem(PLAYER_OVERRIDE_KEY);
			if (override) return override.endsWith("/") ? override : `${override}/`;
		} catch {}
		return PLAYER_URL;
	}
	function openPlayer(raw) {
		const movie = parseMovieRef(raw);
		if (!movie) {
			logger.error("refused to open player: invalid movie ref", raw);
			return;
		}
		const url = playerBase() + buildPlayerQuery(movie, VERSION).slice(1);
		logger.info("opening player", url);
		if (!window.open(url, "_blank")) window.location.assign(url);
	}
	var observer = null;
	var latest = null;
	function tick() {
		const site = detectSite();
		if (!site) return;
		let raw = null;
		try {
			raw = extractors[site]();
		} catch (error) {
			logger.warn("extractor failed", error);
			return;
		}
		if (!raw) return;
		latest = raw;
		ensureButton(site, () => {
			if (latest) openPlayer(latest);
		});
	}
	function init() {
		logger.info(`KinoLink userscript ${VERSION} started`);
		tick();
		observer?.disconnect();
		observer = new MutationObserver(() => tick());
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true
		});
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();
})();
