// Minimal v2 player (oled theme): title in the header, centered 16:9 window,
// sources below, version line top-right. No history, no extra themes yet.

import { parsePlayerQuery } from '../../shared/movie.ts';
import { VERSION, isOutdated } from '../../shared/version.ts';

const SCRIPT_UPDATE_URL =
  'https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/rewrite/v2/web/userscript/dist/kinolink.user.js';

interface Source {
  type: string;
  iframeUrl: string;
}

const PREFERRED_KEY = 'kinolink-preferred-source';
const THEME_KEY = 'kinolink-theme';

const THEMES = {
  oled: { label: 'Pure OLED', dot: '#000000' },
  estvoid: { label: 'est-Void', dot: '#7a2fd0' },
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
    if (event.key === 'Escape') toggleThemeSidebar(false);
  });

  const { movie, scriptVersion } = parsePlayerQuery(location.search);
  renderVersion(scriptVersion);
  if (!movie) {
    showHint('Откройте страницу фильма и нажмите «Смотреть».');
    return;
  }

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
