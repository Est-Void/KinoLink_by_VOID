# KinoLink by VOID

KinoLink — это кнопка «Смотреть» прямо на страницах киносайтов и лёгкий локальный плеер к ней. Нажимаешь кнопку — открывается минималистичный плеер с выбором источника, списком просмотренного (с постерами) и несколькими темами оформления. Всё работает локально: Go-сервер + браузерный userscript, без подписок, рекламы и лишних вкладок.

## Благодарность

Отдельное спасибо [Kirlovon](https://github.com/Kirlovon) — проект основан на его [tape-operator](https://github.com/kirlovon/tape-operator). Без него KinoLink бы не появился.

## Возможности

- Кнопка «Смотреть» на **Кинопоиске, IMDb, TMDB и Letterboxd**.
- Плеер: выбор источника, темы (**Pure OLED / est-Void / Титан**), список просмотренного с постерами, сортировка A–Z / Z–A, повторное открытие фильма.
- Сервер на Go: один статичный бинарник без внешних зависимостей; отдаёт плеер и проксирует Kinobox и обложки (с SSRF-защитой).
- Userscript с автообновлением.

## Быстрый старт

Нужны **Go 1.24+** и **Node.js 22+**.

### 1. Соберите плеер и сервер

```bash
git clone git@github.com:Est-Void/KinoLink_by_VOID.git
cd KinoLink_by_VOID

make web-build   # собирает userscript и player в web/*/dist
make build       # собирает сервер ./kinolink
```

### 2. Запустите сервер

```bash
./kinolink
```

Сервер поднимется на `http://127.0.0.1:8080` и будет отдавать собранный плеер. Порт фиксирован: если он занят, освободите его или укажите другой через `./kinolink --port 8088`. Для разработки есть `make run`.

### 3. Установите userscript

Поставьте [Tampermonkey](https://www.tampermonkey.net/) (или Violentmonkey / Greasemonkey) и установите скрипт:

[`web/userscript/dist/kinolink.user.js`](https://github.com/Est-Void/KinoLink_by_VOID/raw/refs/heads/main/web/userscript/dist/kinolink.user.js)

Скрипт обновляется автоматически и по умолчанию открывает плеер на `http://127.0.0.1:8080/`.

### 4. Смотрите

Откройте страницу фильма на Кинопоиске (`kinopoisk.ru/film/...` или `.../series/...`), IMDb, TMDB или Letterboxd и нажмите **«Смотреть»**.

## Docker

```bash
make web-build              # образ копирует собранный плеер из web/player/dist
docker build -t kinolink .
docker run --rm -p 8080:8080 kinolink
```

## Доступ с других устройств

По умолчанию скрипт открывает плеер на `127.0.0.1:8080`. Чтобы открывать его на другом адресе (например, с телефона в той же сети), запустите сервер с `--lan`:

```bash
./kinolink --lan
```

Сервер выведет адрес вида `http://192.168.1.5:8080`. На другом устройстве один раз задайте этот адрес в консоли браузера на любой странице сайта:

```js
localStorage.setItem('kinolink-player-url', 'http://192.168.1.5:8080/')
```

Не включайте `--lan` в публичной или гостевой сети. Если устройство не видит сервер, откройте `http://LAN_IP:8080/api/status` — должен вернуться JSON со `status: "ok"`.

## Разработка

```bash
make vet test    # go vet + go test
make run         # сервер для разработки (отдаёт web/player/dist)

cd web
npm install
node --test "web/**/*.test.ts"                                   # тесты shared + userscript
./node_modules/.bin/tsc --noEmit -p userscript/tsconfig.json     # типы
./node_modules/.bin/tsc --noEmit -p player/tsconfig.json
npm run build --workspaces                                       # сборка userscript + player
```

Структура репозитория:

- `server/` — Go-сервер: `/api/status`, `/api/players` (прокси Kinobox), `/api/cover` (прокси обложек), статика плеера.
- `web/player/` — плеер (Vite + TypeScript).
- `web/userscript/` — userscript (Vite + vite-plugin-monkey).
- `web/shared/` — общий контракт `MovieRef`, версии и хелпер обложек.

## Цели

- [x] Кнопка «Смотреть» на IMDb, TMDB и Letterboxd
- [ ] Синхронизация списка просмотренного между устройствами
- [ ] Нормальная мобильная вёрстка плеера
- [ ] Хостинг плеера, чтобы не поднимать сервер локально
- [ ] Больше источников и автоматический выбор лучшего качества

Есть идеи или хочешь помочь — открывай issue или присылай PR.

## Отказ от ответственности

KinoLink создан в учебных целях и для личного использования. Проект не хранит, не раздаёт и не публикует видеофайлы — воспроизведение идёт через сторонние публичные источники, за содержимое которых автор ответственности не несёт. Уважайте чужой труд: пиратство — это плохо. Если фильм понравился, поддержите создателей — сходите в кино или оформите подписку на официальный сервис.

## Лицензия

MIT
