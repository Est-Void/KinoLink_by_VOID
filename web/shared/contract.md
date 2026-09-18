# KinoLink v2 — контракт плеера (заморожен, этап 2)

Единственный способ передать фильм в плеер — URL:

```
{PLAYER_URL}/?m=<base64url(JSON MovieRef)>&v=<userscript-version>
```

## MovieRef

```ts
interface MovieRef {
  title: string;          // обязательное, 1..300 символов после trim
  kinopoisk?: string;     // /^\d{1,20}$/
  imdb?: string;          // /^tt\d{1,20}$/
  tmdb?: string;          // /^\d{1,20}$/
  type?: 'movie' | 'series'; // default 'movie'
  cover?: string;         // http(s) URL постера, до 500 символов
  year?: string;          // /^\d{4}$/
  genre?: string;         // строка жанров, до 200 символов
}
```

Правила:
- Хотя бы один внешний ID обязан присутствовать (иначе плееру нечего резолвить).
- Неизвестные ключи плеер отбрасывает, `type` вне enum → `'movie'`.
- `title` после trim пустым быть не может.
- Кодировка `m`: `base64url(UTF-8(JSON))` без паддинга. Почему не plain JSON:
  эмодзи/кавычки/кириллица в title ломают парсинг query и историю браузера.

## Параметр v

- `v` — версия юзерскрипта из `web/shared/version.ts` (`VERSION`, в этой ветке
  всегда `x.y.z-dev`). Плеер сравнивает через `isOutdated(v, VERSION)`.
- `v` отсутствует/мусор/старше → тост «обнови скрипт» со ссылкой на
  `userscript/kinolink.user.js` в репозитории. Новer/равна → молча.
- `-dev` считается старше релиза с теми же цифрами (`2.0.0-dev < 2.0.0`).
- `appVersion` в `server/main.go` дублирует `VERSION` (Go не импортирует TS);
  рассинхрон ловит CI (`web.yml`).

## Поведение плеера

1. Парсит `m` → невалидно → экран «Откройте страницу фильма и нажмите кнопку».
2. `GET {same-origin}/api/players?{id}` — id по приоритету
   `kinopoisk > imdb > tmdb` (см. `pickID` в `server/api.go`).
3. Пустой `data: []` → «Источник не найден».
4. Ошибка сети/502 → «Источники временно недоступны».

## Примеры

`{"title":"Дюна","kinopoisk":"4094466","type":"movie"}` →
`?m=eyJ0aXRsZSI6ItCU0Y7QvdCwIiwidHlwZSI6Im1vdmllIiwia2lub3BvaXNrIjoiNDA5NDQ2NiJ9`

Пример закреплён тестом `contract example` в `movie.test.ts`: если формат
кодирования изменится, тест упадёт вместе с контрактом.

Реализация: `web/shared/movie.ts` (ноль зависимостей, shared между
userscript и player). Тесты: `web/shared/movie.test.ts` (`node --test
"web/**/*.test.ts"`).

Требования к запуску тестов: Node.js ≥ 22.18 (type stripping включён по
умолчанию; на 22.6–22.17 нужен флаг `--experimental-strip-types`). Node
только стирает типы и **не проверяет их** — тесты ловят рантайм-поведение,
но не ошибки типов.
