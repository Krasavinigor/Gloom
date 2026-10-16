export const locales = ['en', 'ru'] as const;
export type Locale = (typeof locales)[number];
export const LOCALE_COOKIE = 'gloom-locale';
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'ru';
export const parseLocale = (value: unknown): Locale => (isLocale(value) ? value : 'en');
export const localeTag = (locale: Locale) => (locale === 'ru' ? 'ru-RU' : 'en-US');
export function localeFromRequest(request: Request): Locale {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .find((part) => part.trim().startsWith(`${LOCALE_COOKIE}=`))
    ?.trim()
    .slice(LOCALE_COOKIE.length + 1);
  try {
    return parseLocale(value === undefined ? undefined : decodeURIComponent(value));
  } catch {
    return 'en';
  }
}
export type MessageSet = { en: Record<string, string>; ru: Record<string, string> };
export function defineMessages<const T extends Record<string, string>>(
  en: T,
  ru: { [K in keyof T]: string },
) {
  return { en, ru };
}
export function translate<T extends MessageSet>(
  locale: Locale,
  messages: T,
  key: keyof T['en'] & string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const message =
    messages[locale][key] ??
    messages.en[key] ??
    (locale === 'ru' ? 'Текст недоступен' : 'Text unavailable');
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}
export function plural(
  locale: Locale,
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
): string {
  return (forms[new Intl.PluralRules(localeTag(locale)).select(count)] ?? forms.other).replace(
    /\{count\}/g,
    new Intl.NumberFormat(localeTag(locale)).format(count),
  );
}
