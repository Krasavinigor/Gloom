import { describe, expect, it } from 'vitest';
import { plural } from '../../src/i18n/core';
import { commonMessages } from '../../src/i18n/messages/common';
import { wardrobeMessages } from '../../src/i18n/messages/wardrobe';
import { recognitionMessages } from '../../src/i18n/messages/recognition';
import { outfitMessages } from '../../src/i18n/messages/outfits';
import { locationWeatherMessages } from '../../src/i18n/messages/location-weather';
import { demoMessages } from '../../src/i18n/messages/demo';
import { errorMessages } from '../../src/i18n/messages/errors';
const dictionaries = { commonMessages, wardrobeMessages, recognitionMessages, outfitMessages, locationWeatherMessages, demoMessages, errorMessages };
describe('bilingual dictionary completeness', () => {
  it.each(Object.entries(dictionaries))('keeps matching nonempty keys and interpolation arguments in %s', (_, messages) => {
    expect(Object.keys(messages.ru).sort()).toEqual(Object.keys(messages.en).sort());
    for (const [key, en] of Object.entries(messages.en)) {
      const ru = messages.ru[key as keyof typeof messages.ru] as string;
      expect(en.trim()).not.toBe(''); expect(ru.trim()).not.toBe('');
      expect((en.match(/\{\w+\}/g) ?? []).sort()).toEqual((ru.match(/\{\w+\}/g) ?? []).sort());
    }
  });
  it('uses English and Russian plural rules with locale-specific number formatting', () => {
    const en = { one: '{count} item', other: '{count} items' };
    const ru = { one: '{count} вещь', few: '{count} вещи', many: '{count} вещей', other: '{count} вещи' };
    expect(plural('en', 1, en)).toBe('1 item'); expect(plural('en', 2, en)).toBe('2 items');
    expect(plural('ru', 1, ru)).toBe('1 вещь'); expect(plural('ru', 2, ru)).toBe('2 вещи');
    expect(plural('ru', 5, ru)).toBe('5 вещей');
  });
});
