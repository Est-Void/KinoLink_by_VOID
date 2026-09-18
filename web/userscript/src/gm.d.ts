// Minimal Tampermonkey API surface used by the userscript.
// Guarded with typeof checks at runtime; localStorage backs the same keys.

interface GMRequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  onload?: (response: { status: number; responseText: string }) => void;
  onerror?: (error: unknown) => void;
  ontimeout?: () => void;
}

declare function GM_xmlhttpRequest(options: GMRequestOptions): void;
declare function GM_getValue(key: string, defaultValue?: string): string;
declare function GM_setValue(key: string, value: string): void;
