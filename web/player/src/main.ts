// Minimal v2 player: title + source buttons + iframe + script-freshness toast.
// No themes, no history, no decoration — those come later.

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
  el('hint').textContent = text;
}

function showToast(installed: string): void {
  const toast = el('toast');
  toast.hidden = false;
  toast.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = `Версия скрипта устарела (${installed || 'неизвестно'} → ${VERSION}). `;
  const link = document.createElement('a');
  link.href = SCRIPT_UPDATE_URL;
  link.target = '_blank';
  link.textContent = 'Обновить скрипт';
  toast.append(span, link);
}

function selectSource(source: Source): void {
  const content = el('content');
  content.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.src = source.iframeUrl;
  frame.allowFullscreen = true;
  content.appendChild(frame);
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
  if (!movie) {
    showHint('Откройте страницу фильма и нажмите «Смотреть».');
    return;
  }
  if (isOutdated(scriptVersion, VERSION)) showToast(scriptVersion);

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
