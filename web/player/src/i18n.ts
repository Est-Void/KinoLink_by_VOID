// Player UI strings. Russian remains the primary language (Kinopoisk
// audience); every other browser locale falls back to English so the
// IMDb/TMDB/Letterboxd users get a native-feeling UI. Only erasable TS
// syntax so node --test can run it without a build step.

export type Lang = 'ru' | 'en';

export interface Strings {
	idle: string;
	corrupted: string;
	loading: string;
	unavailable: string;
	notFound: string;
	emptyHistory: string;
	open: string;
	openAria: (title: string) => string;
	remove: string;
	removeAria: (title: string) => string;
	watchedLabel: string;
	themesLabel: string;
	closeAria: string;
	sortAria: string;
	sourcesAria: string;
}

const RU: Strings = {
	idle: 'Откройте страницу фильма и нажмите «Смотреть».',
	corrupted: 'Ссылка повреждена — откройте фильм заново со страницы фильма.',
	loading: 'Загружаю источники…',
	unavailable: 'Источники временно недоступны. Попробуйте обновить страницу.',
	notFound: 'Источник не найден.',
	emptyHistory: 'Тут пока пусто',
	open: 'Открыть',
	openAria: (title) => `Открыть ${title}`,
	remove: 'Удалить из списка',
	removeAria: (title) => `Удалить ${title}`,
	watchedLabel: 'Просмотренные',
	themesLabel: 'Темы',
	closeAria: 'Закрыть панель',
	sortAria: 'Порядок сортировки',
	sourcesAria: 'Источники воспроизведения',
};

const EN: Strings = {
	idle: 'Open a movie page and press "Watch".',
	corrupted: 'The link is broken — open the movie again from its page.',
	loading: 'Loading sources…',
	unavailable: 'Sources are temporarily unavailable. Try reloading the page.',
	notFound: 'No source found.',
	emptyHistory: 'Nothing here yet',
	open: 'Open',
	openAria: (title) => `Open ${title}`,
	remove: 'Remove from list',
	removeAria: (title) => `Remove ${title}`,
	watchedLabel: 'Watched',
	themesLabel: 'Themes',
	closeAria: 'Close panel',
	sortAria: 'Sort order',
	sourcesAria: 'Playback sources',
};

const STRINGS: Record<Lang, Strings> = { ru: RU, en: EN };

/** ru* locales get Russian, everything else (including garbage) English. */
export function detectLang(language?: string): Lang {
	return (language ?? '').trim().toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function getStrings(lang: Lang): Strings {
	return STRINGS[lang];
}
