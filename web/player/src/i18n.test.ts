import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, getStrings, type Strings } from './i18n.ts';

describe('detectLang', () => {
	it('maps ru* locales to Russian, everything else to English', () => {
		assert.equal(detectLang('ru-RU'), 'ru');
		assert.equal(detectLang('ru'), 'ru');
		assert.equal(detectLang('RU'), 'ru');
		assert.equal(detectLang('en-US'), 'en');
		assert.equal(detectLang('de-DE'), 'en');
		assert.equal(detectLang(''), 'en');
		assert.equal(detectLang(undefined), 'en');
	});
});

describe('getStrings', () => {
	it('provides complete dictionaries for every language', () => {
		for (const lang of ['ru', 'en'] as const) {
			const strings: Strings = getStrings(lang);
			for (const [key, value] of Object.entries(strings)) {
				if (typeof value === 'string') {
					assert.ok(value.length > 0, `${lang}.${key} must not be empty`);
				}
			}
			assert.ok(strings.openAria('Dune').includes('Dune'));
			assert.ok(strings.removeAria('Dune').includes('Dune'));
		}
	});
});
