import { VERSION } from '../../shared/version.ts';
import { detectSite, extractors } from './sites.ts';
import type { RawRef } from './sites.ts';
import { BUTTON_ID, ensureButton } from './button.ts';
import { openPlayer } from './server.ts';
import { logger } from './log.ts';

let observer: MutationObserver | null = null;
// Latest successfully extracted ref. The click handler reads it lazily so
// SPA navigation (film A -> film B without reload) never opens stale data.
let latest: RawRef | null = null;

// SPA pages fire the observer on every DOM mutation. Throttle so the per-site
// extractor (which may scan the whole document) runs at most ~once per interval.
const TICK_INTERVAL = 150;
let tickTimer: ReturnType<typeof setTimeout> | null = null;

// Drop both the ref and the button: a button must never open the previously
// seen film after navigating to a non-movie page.
function clearButton(): void {
  latest = null;
  document.getElementById(BUTTON_ID)?.remove();
}

function tick(): void {
  const site = detectSite();
  if (!site) {
    clearButton();
    return;
  }
  let raw: RawRef | null = null;
  try {
    raw = extractors[site]();
  } catch (error) {
    logger.warn('extractor failed', error);
    return;
  }
  if (!raw) {
    clearButton();
    return;
  }
  latest = raw;
  ensureButton(site, () => {
    if (latest) void openPlayer(latest);
  });
}

function scheduleTick(): void {
  if (tickTimer !== null) return;
  tickTimer = setTimeout(() => {
    tickTimer = null;
    tick();
  }, TICK_INTERVAL);
}

function init(): void {
  logger.info(`KinoLink userscript ${VERSION} started`);
  tick();
  observer?.disconnect();
  observer = new MutationObserver(() => scheduleTick());
  observer.observe(document.documentElement, { subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
