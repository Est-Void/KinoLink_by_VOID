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
}
```

Правила:
- Хотя бы один внешний ID обязан присутствовать (иначе плееру нечего резолвить).
- Неизвестные ключи плеер отбрасывает, `type` вне enum → `'movie'`.
- `title` после trim пустым быть не может.
- Кодировка `m`: `base64url(UTF-8(JSON))` без паддинга. Почему не plain JSON:
  эмодзи/кавычки/кириллица в title ломают парсинг query и историю браузера.

## Параметр v

- `v` — версия юзерскрипта (`1.0.0`, semver). Плеер сравнивает со своей
  `REQUIRED_SCRIPT_VERSION`: `v < required` → тост «обнови скрипт».
- Отсутствие `v` = очень старый скрипт → тот же тост.

## Поведение плеера

1. Парсит `m` → невалидно → экран «Откройте страницу фильма и нажмите кнопку».
2. `GET {same-origin}/api/players?{id}` — id по приоритету
   `kinopoisk > imdb > tmdb` (см. `pickID` в `server/api.go`).
3. Пустой `data: []` → «Источник не найден».
4. Ошибка сети/502 → «Источники временно недоступны».

## Примеры

`{"title":"Дюна","kinopoisk":"...","type":"movie"}` →
`?m=eyJ0aXRsZSI6ItCU0Y7QvdCwIiwia2lub3BvaXNrIjoiLi4uIiwidHlwZSI6Im1vdmllIn0`

Реализация: `web/shared/movie.ts` (ноль зависимостей, shared между
userscript и player). Тесты: `web/shared/movie.test.ts` (`node --test`).
