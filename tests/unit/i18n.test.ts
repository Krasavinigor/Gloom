import { describe, expect, it } from 'vitest';
import { defineMessages, localeFromRequest, localeTag, parseLocale, translate } from '../../src/i18n/core';
describe('locale boundary and typed dictionaries', () => {
  it('defaults to English without inferring language from headers or location', () => {
    expect(parseLocale(undefined)).toBe('en');
    expect(parseLocale('ru')).toBe('ru');
    for (const value of ['RU', 'fr', '', null, 1]) expect(parseLocale(value)).toBe('en');
    expect(localeFromRequest(new Request('http://localhost', { headers: { 'Accept-Language': 'ru' } }))).toBe('en');
    expect(localeFromRequest(new Request('http://localhost', { headers: { cookie: 'other=ru; gloom-locale=ru' } }))).toBe('ru');
    expect(localeFromRequest(new Request('http://localhost', { headers: { cookie: 'gloom-locale=%oops' } }))).toBe('en');
  });
  it('interpolates translated messages with an English fallback and consistent Intl locales', () => {
    const messages = defineMessages({ greeting: 'Hello, {name}!' }, { greeting: 'Привет, {name}!' });
    expect(translate('en', messages, 'greeting', { name: 'Ada' })).toBe('Hello, Ada!');
    expect(translate('ru', messages, 'greeting', { name: 'Ada' })).toBe('Привет, Ada!');
    expect(translate('ru', { en: { title: 'Wardrobe' }, ru: {} }, 'title')).toBe('Wardrobe');
    expect(localeTag('en')).toBe('en-US');
    expect(localeTag('ru')).toBe('ru-RU');
  });
});
