// In-DOM «Смотреть» button. Kinopoisk cascade: desktop button row ->
// title fallback (mobile landing) -> floating button. Other sites: anchor
// or floating fallback.

import type { Site } from './sites.ts';
import { logger } from './log.ts';

export const BUTTON_ID = 'kinolink-watch-button';

let currentOnClick: () => void = () => {};

function makeButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = BUTTON_ID;
  btn.type = 'button';
  btn.title = 'Смотреть через KinoLink';
  btn.addEventListener('click', () => currentOnClick());
  return btn;
}

// Мобильный лендинг: ряд «Оценить | Буду смотреть | Добавить | Еще» —
// текстовые элементы без title. Ищем листовой узел с точным текстом.
function kinopoiskMobileActionRow(): Element | null {
  const nodes = Array.from(document.querySelectorAll('button, a, span, div'));
  for (const node of nodes) {
    if (node.children.length === 0 && node.textContent?.trim() === 'Буду смотреть') {
      return node.parentElement;
    }
  }
  return null;
}

function kinopoiskReferenceButton(): HTMLButtonElement | null {
  // «Буду смотреть» — живая кнопка Кинопоиска рядом с нашей.
  const found = Array.from(document.querySelectorAll('button')).find(
    (el) => el.getAttribute('title') === 'Буду смотреть',
  );
  return found instanceof HTMLButtonElement ? found : null;
}

// Кнопка как в main: классы Кинопоиска (точная геометрия) + градиентная
// заливка поверх + лёгкое «дыхание» свечения.
const KP_BUTTON_CLASSES = [
  'style_button__Awsrq',
  'style_buttonSize52__MBeHC',
  'style_buttonPrimary__Qn_9l',
  'style_buttonDark__pBW5l',
  'style_withIconLeft__USlpL',
].join(' ');

const KP_WRAPPER_CLASS = 'styles_button__bW_ew';

function injectBreathStyle(): void {
  if (document.getElementById('kinolink-breath')) return;
  const style = document.createElement('style');
  style.id = 'kinolink-breath';
  style.textContent = [
    '@keyframes kinolink-breathe {',
    '  0%, 100% { box-shadow: 0 0 8px rgba(122, 47, 208, 0.35); }',
    '  50% { box-shadow: 0 0 20px rgba(122, 47, 208, 0.75); }',
    '}',
    `#${BUTTON_ID} { animation: kinolink-breathe 3s ease-in-out infinite; }`,
  ].join('\n');
  document.head.appendChild(style);
}

function attachMainStyleButton(ref: HTMLButtonElement): void {
  const btn = makeButton();
  const wrapper = document.createElement('div');
  wrapper.className = KP_WRAPPER_CLASS;
  wrapper.style.display = 'inline-flex';
  wrapper.style.marginRight = '8px';

  btn.className = KP_BUTTON_CLASSES;
  btn.setAttribute('aria-pressed', 'false');
  btn.style.setProperty('background', 'linear-gradient(45deg, #2b0a45 0%, #000000 100%)', 'important');
  btn.style.setProperty('background-color', 'transparent', 'important');

  const icon = document.createElement('span');
  icon.style.display = 'flex';
  icon.style.alignItems = 'center';
  icon.style.justifyContent = 'center';
  icon.innerHTML =
    '<svg width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3.375 21 12 6 20.625V3.375Z" fill="#ffffff"/></svg>';

  btn.appendChild(icon);
  btn.appendChild(document.createTextNode('Смотреть'));
  wrapper.appendChild(btn);
  // Соседом самой кнопки, а не её контейнера — иначе выпадаем из ряда.
  ref.before(wrapper);
}

// Мобильный лендинг: широкая кнопка после якоря, тач-френдли 48px.
function attachMobileButton(after: Element, mode: 'after' | 'append'): void {
  const btn = makeButton();
  btn.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:8px',
    'width:100%',
    'min-height:48px',
    'margin:12px 0',
    'padding:12px 16px',
    'font-size:17px',
    'font-weight:700',
    'color:#fff',
    'background:linear-gradient(45deg, #2b0a45 0%, #000000 100%)',
    'border:1px solid #7a2fd0',
    'border-radius:12px',
    'cursor:pointer',
  ].join(';');
  btn.innerHTML =
    '<svg width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3.375 21 12 6 20.625V3.375Z" fill="#ffffff"/></svg>';
  btn.appendChild(document.createTextNode('Смотреть'));
  if (mode === 'append') after.appendChild(btn);
  else after.after(btn);
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

function styleFallbackButton(btn: HTMLButtonElement, floating: boolean): void {
  btn.textContent = '▶ Смотреть';
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
  currentOnClick = onClick;

  // Кинопоиск: каскад десктопный ряд -> заголовок (мобильный лендинг) ->
  // общий фолбэк. Каждый шаг логируется, чтобы по консоли было видно,
  // какой якорь сработал на конкретном устройстве.
  if (site === 'kinopoisk') {
    injectBreathStyle();
    const ref = kinopoiskReferenceButton();
    if (ref) {
      attachMainStyleButton(ref);
      logger.info('kp anchor: desktop-ref');
      return;
    }
    const actions = kinopoiskMobileActionRow();
    if (actions) {
      attachMobileButton(actions, 'after');
      logger.info('kp anchor: mobile-actions');
      return;
    }
    const title = document.querySelector('main h1, article h1, h1');
    if (title) {
      attachMobileButton(title, 'after');
      logger.info('kp anchor: title-fallback');
      return;
    }
    logger.info('kp anchor: none');
  }

  const btn = makeButton();
  const anchor = findAnchor(site);
  if (!anchor) {
    logger.warn('no anchor for', site, '— using floating button');
    styleFallbackButton(btn, true);
    document.body.appendChild(btn);
    return;
  }
  styleFallbackButton(btn, false);
  if (anchor.mode === 'before') anchor.parent.before(btn);
  else if (anchor.mode === 'after') anchor.parent.after(btn);
  else anchor.parent.appendChild(btn);
  logger.info('button attached', site);
}
