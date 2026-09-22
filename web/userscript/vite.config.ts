import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { VERSION } from '../shared/version.ts';

// Direct install/reinstall link (same role as the README link).
const DOWNLOAD_URL =
  'https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/main/web/userscript/dist/kinolink.user.js';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'KinoLink by VOID',
        namespace: 'kinolink',
        version: VERSION,
        description: 'KinoLink v2 — watch button for Kinopoisk, IMDb, TMDB, Letterboxd',
        author: 'VOID',
        license: 'MIT',
        homepageURL: 'https://github.com/Est-Void/KinoLink_by_VOID',
        supportURL: 'https://github.com/Est-Void/KinoLink_by_VOID/issues',
        // The button injects into the top page only; inside site iframes it
        // would only waste MutationObserver ticks and risk duplicate buttons.
        noframes: true,
        match: [
          '*://www.kinopoisk.ru/*',
          '*://hd.kinopoisk.ru/*',
          '*://*.imdb.com/title/*',
          '*://www.themoviedb.org/movie/*',
          '*://www.themoviedb.org/tv/*',
          '*://letterboxd.com/film/*',
          '*://www.netflix.com/title/*',
          '*://www.rottentomatoes.com/m/*',
          '*://www.rottentomatoes.com/tv/*',
        ],
        updateURL: DOWNLOAD_URL,
        downloadURL: DOWNLOAD_URL,
        grant: [],
        connect: [],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    minify: false,
  },
});
