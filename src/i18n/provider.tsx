'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isLocale, localeTag, translate, type Locale, type MessageSet } from './core';
import { commonMessages } from './messages/common';

type Context = { locale: Locale; setLocale: (locale: Locale) => Promise<void> };
const I18nContext = createContext<Context>({ locale: 'en', setLocale: async () => {} });
export function I18nProvider({
  initialLocale = 'en',
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, updateLocale] = useState<Locale>(initialLocale);
  const pathname = usePathname();
  async function setLocale(next: Locale) {
    if (!isLocale(next)) throw new Error('Invalid locale');
    if (next === locale) return;
    const response = await fetch('/api/locale', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success !== true || payload.data?.locale !== next)
      throw new Error('Locale update failed');
    updateLocale(next);
  }
  useEffect(() => {
    document.documentElement.lang = locale;
    const path = pathname ?? window.location.pathname;
    const key =
      path === '/demo/wardrobe'
        ? 'demoWardrobeTitle'
        : path === '/demo'
          ? 'demoTitle'
          : path === '/wardrobe'
            ? 'wardrobeTitle'
            : path === '/outfits' || path === '/'
              ? 'outfitsTitle'
              : 'defaultTitle';
    document.title = translate(locale, commonMessages, key);
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', translate(locale, commonMessages, 'description'));
  }, [locale, pathname]);
  return <I18nContext.Provider value={{ locale, setLocale }}>{children}</I18nContext.Provider>;
}
type I18n<T extends MessageSet> = Context & {
  t: (key: keyof T['en'] & string, params?: Readonly<Record<string, string | number>>) => string;
  intlLocale: string;
};
export function useI18n(): I18n<typeof commonMessages>;
export function useI18n<T extends MessageSet>(messages: T): I18n<T>;
export function useI18n(messages: MessageSet = commonMessages): I18n<MessageSet> {
  const context = useContext(I18nContext);
  return {
    ...context,
    intlLocale: localeTag(context.locale),
    t: (key, params) => translate(context.locale, messages, key, params),
  };
}
