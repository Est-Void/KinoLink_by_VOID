// Minimal v2 player (oled theme): title in the header, centered 16:9 window,
// sources below, version line top-right. No history, no extra themes yet.

import { buildPlayerQuery, parseMovieRef, parsePlayerQuery } from '../../shared/movie.ts';
import type { MovieRef } from '../../shared/movie.ts';
import { VERSION, isOutdated } from '../../shared/version.ts';

const SCRIPT_UPDATE_URL =
  'https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/rewrite/v2/web/userscript/dist/kinolink.user.js';

interface Source {
  type: string;
  iframeUrl: string;
}

const PREFERRED_KEY = 'kinolink-preferred-source';
const THEME_KEY = 'kinolink-theme';
const WATCHED_KEY = 'kinolink-watched';
const WATCHED_SORT_KEY = 'kinolink-watched-sort';

interface WatchedMovie extends MovieRef {
  timestamp: number;
}

let currentMovie: MovieRef | null = null;

function sameMovie(a: MovieRef, b: MovieRef): boolean {
  if (a.kinopoisk && b.kinopoisk) return a.kinopoisk === b.kinopoisk;
  if (a.imdb && b.imdb) return a.imdb === b.imdb;
  if (a.tmdb && b.tmdb) return a.tmdb === b.tmdb;
  return a.title === b.title;
}

function getWatchedMovies(): WatchedMovie[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCHED_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const { timestamp, ...rest } = (item ?? {}) as Record<string, unknown>;
      const movie = parseMovieRef(rest);
      return movie ? [{ ...movie, timestamp: typeof timestamp === 'number' ? timestamp : 0 }] : [];
    });
  } catch {
    return [];
  }
}

function saveWatchedMovie(movie: MovieRef): void {
  try {
    const rest = getWatchedMovies().filter((item) => !sameMovie(item, movie));
    rest.unshift({ ...movie, timestamp: Date.now() });
    localStorage.setItem(WATCHED_KEY, JSON.stringify(rest.slice(0, 200)));
  } catch { /* storage full or unavailable — history is best-effort */ }
}

function deleteWatchedMovie(movie: MovieRef): void {
  try {
    localStorage.setItem(
      WATCHED_KEY,
      JSON.stringify(getWatchedMovies().filter((item) => !sameMovie(item, movie))),
    );
  } catch { /* ignore */ }
  renderWatchedMovies();
}

function reopenMovie(movie: MovieRef): void {
  // timestamp отбрасывается самим parseMovieRef внутри encode.
  window.location.assign(`${window.location.pathname}${buildPlayerQuery(movie, VERSION)}`);
}

function renderWatchedMovies(): void {
  const list = el('watched-list');
  list.innerHTML = '';
  const watched = getWatchedMovies();
  if (watched.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'watched-empty';
    empty.textContent = 'Тут пока пусто';
    list.appendChild(empty);
    return;
  }

  const desc = localStorage.getItem(WATCHED_SORT_KEY) === 'desc';
  const sorted = [...watched].sort(
    (a, b) => a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' }) * (desc ? -1 : 1),
  );
  updateSortLabel();

  for (const movie of sorted) {
    const item = document.createElement('div');
    item.className = 'watched-item';
    if (currentMovie && sameMovie(movie, currentMovie)) item.classList.add('selected');

    const coverBtn = document.createElement('button');
    coverBtn.type = 'button';
    coverBtn.className = 'cover-btn';
    coverBtn.title = 'Открыть';
    coverBtn.setAttribute('aria-label', `Открыть ${movie.title}`);
    if (movie.cover) {
      const img = document.createElement('img');
      img.className = 'cover';
      img.alt = '';
      img.loading = 'lazy';
      img.src = movie.cover;
      img.addEventListener('error', () => {
        coverBtn.classList.add('no-cover');
        img.remove();
      });
      coverBtn.appendChild(img);
    } else {
      coverBtn.classList.add('no-cover');
    }
    coverBtn.addEventListener('click', () => reopenMovie(movie));

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'info';
    info.title = 'Открыть';
    const title = document.createElement('span');
    title.className = 'row title';
    title.textContent = movie.title;
    info.appendChild(title);
    for (const text of [movie.genre, movie.year].filter(Boolean)) {
      const row = document.createElement('span');
      row.className = 'row';
      row.textContent = text ?? '';
      info.appendChild(row);
    }
    info.addEventListener('click', () => reopenMovie(movie));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-btn';
    del.title = 'Удалить из списка';
    del.setAttribute('aria-label', `Удалить ${movie.title}`);
    del.textContent = '×';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteWatchedMovie(movie);
    });

    item.append(coverBtn, info, del);
    list.appendChild(item);
  }
}

function updateSortLabel(): void {
  const sort = el('sort-toggle');
  const desc = localStorage.getItem(WATCHED_SORT_KEY) === 'desc';
  sort.textContent = desc ? 'Z–A' : 'A–Z';
}

function toggleWatchedSidebar(open?: boolean): void {
  const sidebar = el('watched-sidebar');
  const toggle = el('watched-toggle');
  const willOpen = open ?? !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', willOpen);
  toggle.classList.toggle('active', willOpen);
  toggle.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) renderWatchedMovies();
}

const THEMES = {
  oled: { label: 'Pure OLED', dot: '#000000' },
  estvoid: { label: 'est-Void', dot: '#6b4fa1' },
  titan: { label: 'Титан', dot: '#e07a00' },
} as const;

type Theme = keyof typeof THEMES;

function currentTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'estvoid' || stored === 'titan' ? stored : 'oled';
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll('.theme-option').forEach((option) => {
    const active = (option as HTMLElement).dataset.theme === theme;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
}

function renderThemeOptions(): void {
  const list = el('theme-list');
  list.innerHTML = '';
  (Object.keys(THEMES) as Theme[]).forEach((id) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.dataset.theme = id;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = THEMES[id].dot;
    const name = document.createElement('span');
    name.textContent = THEMES[id].label;
    option.append(dot, name);
    option.addEventListener('click', () => {
      applyTheme(id);
      toggleThemeSidebar(false);
    });
    list.appendChild(option);
  });
  applyTheme(currentTheme());
}

function toggleThemeSidebar(open?: boolean): void {
  const sidebar = el('theme-sidebar');
  const toggle = el('theme-toggle');
  const willOpen = open ?? !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', willOpen);
  toggle.classList.toggle('active', willOpen);
  toggle.setAttribute('aria-expanded', String(willOpen));
}

let resizeHandler: (() => void) | null = null;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function showHint(text: string): void {
  const frame = el('frame');
  frame.innerHTML = '';
  const p = document.createElement('p');
  p.id = 'hint';
  p.textContent = text;
  frame.appendChild(p);
}

// Always shows the installed script version; when it is older than the
// player, appends "New -> <required>" linking to the script update.
function renderVersion(installed: string): void {
  const version = el('version');
  version.innerHTML = '';
  version.append(`V-${installed || '?.?.?'}`);
  if (isOutdated(installed, VERSION)) {
    version.classList.add('update');
    const sep = document.createElement('span');
    sep.textContent = ' · New -> ';
    const link = document.createElement('a');
    link.href = SCRIPT_UPDATE_URL;
    link.target = '_blank';
    link.textContent = VERSION;
    version.append(sep, link);
  }
}

function selectSource(source: Source): void {
  const frame = el('frame');
  frame.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.src = source.iframeUrl;
  iframe.allowFullscreen = true;
  frame.appendChild(iframe);
}

function renderSources(sources: Source[]): void {
  const bar = el('sources');
  bar.innerHTML = '';
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);

  const indicator = document.createElement('div');
  indicator.className = 'source-indicator';
  bar.appendChild(indicator);

  const updateIndicator = (): void => {
    const selected = bar.querySelector('.source.selected');
    if (!(selected instanceof HTMLElement)) return;
    indicator.style.transform = `translateX(${selected.offsetLeft - bar.offsetLeft}px)`;
    indicator.style.width = `${selected.offsetWidth}px`;
  };
  resizeHandler = updateIndicator;

  const preferred = localStorage.getItem(PREFERRED_KEY);
  let active = sources.findIndex((s) => s.type === preferred);
  if (active === -1) active = 0;
  sources.forEach((source, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'source';
    btn.textContent = source.type;
    if (index === active) {
      btn.classList.add('selected');
      selectSource(source);
    }
    btn.addEventListener('click', () => {
      if (btn.classList.contains('selected')) return;
      bar.querySelectorAll('.source').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      localStorage.setItem(PREFERRED_KEY, source.type);
      selectSource(source);
      updateIndicator();
    });
    bar.appendChild(btn);
  });

  requestAnimationFrame(updateIndicator);
  window.addEventListener('resize', updateIndicator);
}

async function init(): Promise<void> {
  renderThemeOptions();

  el('theme-toggle').addEventListener('click', () => toggleThemeSidebar());
  el('theme-close').addEventListener('click', () => toggleThemeSidebar(false));
  document.addEventListener('click', (event) => {
    const sidebar = el('theme-sidebar');
    if (!sidebar.classList.contains('open')) return;
    const target = event.target as Node;
    if (!sidebar.contains(target) && !el('theme-toggle').contains(target)) {
      toggleThemeSidebar(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      toggleThemeSidebar(false);
      toggleWatchedSidebar(false);
    }
  });

  el('watched-toggle').addEventListener('click', () => toggleWatchedSidebar());
  el('watched-close').addEventListener('click', () => toggleWatchedSidebar(false));
  el('sort-toggle').addEventListener('click', () => {
    const desc = localStorage.getItem(WATCHED_SORT_KEY) === 'desc';
    localStorage.setItem(WATCHED_SORT_KEY, desc ? 'asc' : 'desc');
    renderWatchedMovies();
  });

  const { movie, scriptVersion } = parsePlayerQuery(location.search);
  renderVersion(scriptVersion);
  if (!movie) {
    showHint('Откройте страницу фильма и нажмите «Смотреть».');
    return;
  }
  currentMovie = movie;
  saveWatchedMovie(movie);

  document.title = `${movie.title} | KinoLink`;
  el('title').textContent = movie.title;

  const id = movie.kinopoisk
    ? `kinopoisk=${encodeURIComponent(movie.kinopoisk)}`
    : movie.imdb
      ? `imdb=${encodeURIComponent(movie.imdb)}`
      : `tmdb=${encodeURIComponent(movie.tmdb ?? '')}`;
  let sources: Source[];
  try {
    const res = await fetch(`/api/players?${id}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { data?: Source[] };
    sources = (body.data ?? []).filter((s) => s?.type && s?.iframeUrl);
  } catch (error) {
    console.error('[KinoLink player]', error);
    showHint('Источники временно недоступны. Попробуйте обновить страницу.');
    return;
  }
  if (sources.length === 0) {
    showHint('Источник не найден.');
    return;
  }
  renderSources(sources);
}

document.addEventListener('DOMContentLoaded', () => void init());
