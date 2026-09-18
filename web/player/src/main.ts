// Minimal v2 player (oled theme): title in the header, centered 16:9 window,
// sources below, version line top-right. No history, no extra themes yet.

import { parsePlayerQuery } from '../../shared/movie';
import { VERSION, isOutdated } from '../../shared/version';

const SCRIPT_UPDATE_URL =
  'https://github.com/Est-Void/KinoLink_by_VOID/blob/rewrite/v2/web/userscript';

interface Source {
  type: string;
  iframeUrl: string;
}

const PREFERRED_KEY = 'kinolink-preferred-source';

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
  const preferred = localStorage.getItem(PREFERRED_KEY);
  let active = sources.findIndex((s) => s.type === preferred);
  if (active === -1) active = 0;
  sources.forEach((source, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = source.type;
    if (index === active) {
      btn.classList.add('selected');
      selectSource(source);
    }
    btn.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      localStorage.setItem(PREFERRED_KEY, source.type);
      selectSource(source);
    });
    bar.appendChild(btn);
  });
}

async function init(): Promise<void> {
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
