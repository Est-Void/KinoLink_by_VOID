// In-DOM «Смотреть» button. Per-site anchors with a floating fallback so the
// button is always reachable even when the site markup changes.
// Styling is intentionally bare — decoration comes later.

import type { Site } from './sites.ts';
import { logger } from './log.ts';

export const BUTTON_ID = 'kinolink-watch-button';

function kinopoiskReferenceButton(): HTMLButtonElement | null {
  // «Буду смотреть» — живая кнопка Кинопоиска рядом с нашей. Копируем её
  // вычисленные стили, а не классы: CSS-модули КП переименовываются.
  const found = Array.from(document.querySelectorAll('button')).find(
    (el) => el.getAttribute('title') === 'Буду смотреть',
  );
  return found instanceof HTMLButtonElement ? found : null;
}

const KP_STYLE_PROPS = [
  'backgroundColor',
  'backgroundImage',
  'color',
  'border',
  'borderRadius',
  'height',
  'paddingLeft',
  'paddingRight',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'letterSpacing',
  'textTransform',
] as const;

// Кнопка как у Кинопоиска: та же геометрия и заливка, что у соседней.
function styleKinopoiskButton(btn: HTMLButtonElement, ref: HTMLButtonElement): void {
  const computed = getComputedStyle(ref);
  for (const prop of KP_STYLE_PROPS) {
    const value = computed[prop];
    if (value) btn.style[prop] = value;
  }
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.gap = '8px';
  btn.style.marginRight = '8px';
  btn.style.cursor = 'pointer';
  btn.style.flexShrink = '0';
}

function findAnchor(site: Site): { parent: Element; mode: 'before' | 'after' | 'append' } | null {
  switch (site) {
    case 'kinopoisk': {
      const ref = kinopoiskReferenceButton();
      const anchor = ref?.parentElement;
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
  btn.title = 'Смотреть через KinoLink';
  btn.addEventListener('click', onClick);

  // Кинопоиск: кнопка-близнец соседней (иконка + текст, стили один в один).
  if (site === 'kinopoisk') {
    const ref = kinopoiskReferenceButton();
    if (ref?.parentElement) {
      btn.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor"/></svg>';
      btn.appendChild(document.createTextNode('Смотреть'));
      styleKinopoiskButton(btn, ref);
      ref.parentElement.before(btn);
      logger.info('button attached', site);
      return;
    }
  }

  btn.textContent = '▶ Смотреть';
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
