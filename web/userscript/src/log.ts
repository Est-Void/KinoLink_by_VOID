export const logger = {
  info: (...args: unknown[]) => console.info('[KinoLink]', ...args),
  warn: (...args: unknown[]) => console.warn('[KinoLink]', ...args),
  error: (...args: unknown[]) => console.error('[KinoLink]', ...args),
};
