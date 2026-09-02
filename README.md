# KinoLink by VOID

Лёгкий плеер для просмотра фильмов и сериалов с Кинопоиска через встроенный iframe.

## О проекте

KinoLink — пользовательский скрипт + локальный сервер/плеер, который добавляет кнопку «Смотреть» на страницах Кинопоиска и открывает минималистичный плеер с выбранным источником видео.

## Архитектура

```
KinoLink_by_VOID/
├── userscript/
│   └── kinolink.user.js       # Userscript для Kinopoisk — внедряет кнопку «Смотреть»
├── player/
│   ├── index.html              # Главная страница плеера
│   ├── style.css               # Стили (4 темы: Violet, Graphite, OLED, est-Void)
│   ├── player.js               # Логика плеера (источники, темы, просмотренные)
│   ├── config.js               # Конфигурация (API, провайдеры)
│   ├── utils.js                # Утилиты (хеширование, URL, debounce)
│   ├── server.py               # Локальный сервер (прокси Kinobox + cover)
│   └── assets/
│       └── play.png            # Иконка плеера
├── expl/
│   └── Кинопоиск.html          # Экспериментальная страница
└── README.md
```

## Установка и запуск

### 1. Клонировать репозиторий

```bash
git clone git@github.com:Est-Void/KinoLink_by_VOID.git
cd KinoLink_by_VOID
```

### 2. Установить userscript в браузере

**Tampermonkey / Violentmonkey / Greasemonkey:**

1. Установите расширение для userscript (например, [Tampermonkey](https://www.tampermonkey.net/))
2. Установите скрипт, перейдя по [этой ссылке](https://github.com/Est-Void/KinoLink_by_VOID/raw/main/userscript/kinolink.user.js). _(либо скачайте `userscript/kinolink.user.js` из репозитория и установите вручную)_
3. Убедитесь, что `@match *://www.kinopoisk.ru/*` указан корректно
4. На страницах Кинопоиска появится кнопка «Смотреть»

### 3. Запустить локальный сервер

```bash
cd player
python3 server.py
```

Сервер запустится на `http://127.0.0.1:8080`.

### 4. Открыть плеер

1. Перейдите на страницу фильма на Кинопоиске (`kinopoisk.ru/film/...`)
2. Нажмите кнопку **«Смотреть»** — откроется плеер на `localhost:8080`

Или напрямую: `http://127.0.0.1:8080/?movie={"title":"...","kinopoisk":"...",...}`

## Темы

Переключение тем через кнопку в шапке плеера (или горячую клавишу):

| Темы | Описание |
| --- | --- |
| **Виолетовая** | Тёмная с фиолетовым акцентом (классический VOID) |
| **Тёмно-серая** | Стальная гамма без цветового акцента |
| **OLED** | Чистый чёрный, без фоновых градиентов |
| **est-Void** | Инженерный минимализм — серо-оранжевые тона |

Настройки тем сохраняются в `localStorage`.

## Технологии

- **Frontend**: Vanilla JS, HTML, CSS (без фреймворков)
- **Backend**: Python 3 (`http.server`)
- **API**: Kinobox (`api.kinobox.tv`, `fbphdplay.top`), TMDB, Wikidata
- **Userscript**: Tampermonkey API

## Лицензия

MIT
