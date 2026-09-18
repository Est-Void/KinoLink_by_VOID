import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { VERSION } from '../shared/version';

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
        match: [
          '*://www.kinopoisk.ru/*',
          '*://hd.kinopoisk.ru/*',
          '*://*.imdb.com/title/*',
          '*://www.themoviedb.org/movie/*',
          '*://www.themoviedb.org/tv/*',
          '*://letterboxd.com/film/*',
        ],
        grant: ['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue'],
        connect: ['*'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    minify: false,
  },
});
