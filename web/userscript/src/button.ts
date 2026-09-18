// In-DOM «Смотреть» button. Per-site anchors with a floating fallback so the
// button is always reachable even when the site markup changes.
// Styling is intentionally bare — decoration comes later.

import type { Site } from './sites';
import { logger } from './log';

export const BUTTON_ID = 'kinolink-watch-button';

function kinopoiskAnchor(): Element | null {
  // v1 approach: sit next to the «Буду смотреть» button.
  const btn = Array.from(document.querySelectorAll('button')).find(
    (el) => el.getAttribute('title') === 'Буду смотреть',
  );
  return btn?.parentElement ?? null;
}

function findAnchor(site: Site): { parent: Element; mode: 'before' | 'after' | 'append' } | null {
  switch (site) {
    case 'kinopoisk': {
      const anchor = kinopoiskAnchor();
      return anchor ? { parent: anchor, mode: 'before' } : null;
    }
    case 'imdb': {
      const hero = document.querySelector('[data-testid="hero-title-block"]');
      return hero ? { parent: hero, mode: 'after' } : null;
    }
    case 'tmdb': {
      const title = document.querySelector('.header .title, .title');
      return title ? { parent: title, mode: 'after' } : null;
    }
    case 'letterboxd': {
      const title =
        document.querySelector('.film-title-wrapper') ?? document.querySelector('h1.headline-1');
      return title ? { parent: title, mode: 'after' } : null;
    }
  }
}

function styleButton(btn: HTMLButtonElement, floating: boolean): void {
  btn.style.cssText = [
    'background:#2b0a45',
    'color:#fff',
    'border:1px solid #7a2fd0',
    'border-radius:8px',
    'padding:10px 16px',
    'font-size:15px',
    'font-weight:700',
    'cursor:pointer',
    'z-index:2147483647',
    ...(floating
      ? ['position:fixed', 'right:16px', 'bottom:16px', 'box-shadow:0 4px 16px rgba(0,0,0,.5)']
      : ['margin:8px 8px 8px 0']),
  ].join(';');
}

export function ensureButton(site: Site, onClick: () => void): void {
  if (document.getElementById(BUTTON_ID)) return;

  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.type = 'button';
  btn.textContent = '▶ Смотреть';
  btn.title = 'Смотреть через KinoLink';
  btn.addEventListener('click', onClick);

  const anchor = findAnchor(site);
  if (!anchor) {
    logger.warn('no anchor for', site, '— using floating button');
    styleButton(btn, true);
    document.body.appendChild(btn);
    return;
  }
  styleButton(btn, false);
  if (anchor.mode === 'before') anchor.parent.before(btn);
  else if (anchor.mode === 'after') anchor.parent.after(btn);
  else anchor.parent.appendChild(btn);
  logger.info('button attached', site);
}
