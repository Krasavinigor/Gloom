import type { Metadata } from 'next';
import { QueryProvider } from '@/components/query-provider';
import { I18nProvider } from '@/i18n/provider';
import { getServerLocale } from '@/i18n/server';
import { translate } from '@/i18n/core';
import { commonMessages } from '@/i18n/messages/common';
import './globals.css';
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return {
    title: {
      default: translate(locale, commonMessages, 'defaultTitle'),
      template: '%s · Gloom',
    },
    description: translate(locale, commonMessages, 'description'),
  };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getServerLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider initialLocale={locale}>
          <QueryProvider>{children}</QueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
