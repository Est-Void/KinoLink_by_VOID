import { VERSION } from '../../shared/version.ts';
import { detectSite, extractors } from './sites.ts';
import type { RawRef } from './sites.ts';
import { ensureButton } from './button.ts';
import { openPlayer } from './server.ts';
import { logger } from './log.ts';

let observer: MutationObserver | null = null;
// Latest successfully extracted ref. The click handler reads it lazily so
// SPA navigation (film A -> film B without reload) never opens stale data.
let latest: RawRef | null = null;

function tick(): void {
  const site = detectSite();
  if (!site) return;
  let raw: RawRef | null = null;
  try {
    raw = extractors[site]();
  } catch (error) {
    logger.warn('extractor failed', error);
    return;
  }
  if (!raw) return;
  latest = raw;
  ensureButton(site, () => {
    if (latest) void openPlayer(latest);
  });
}

function init(): void {
  logger.info(`KinoLink userscript ${VERSION} started`);
  tick();
  observer?.disconnect();
  observer = new MutationObserver(() => tick());
  observer.observe(document.documentElement, { subtree: true, childList: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
