'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/i18n/provider';
import { LanguageSwitcher } from '@/i18n/language-switcher';
export function AppShell({
  children,
  mode,
  active,
}: {
  children: ReactNode;
  mode: 'demo' | 'personal';
  active: 'outfits' | 'wardrobe';
}) {
  const { t } = useI18n();
  const base = mode === 'demo' ? '/demo' : '';
  const links = [
    {
      href: mode === 'demo' ? '/demo' : '/outfits',
      label: t('outfits'),
      id: 'outfits',
    },
    { href: `${base}/wardrobe`, label: t('wardrobe'), id: 'wardrobe' },
  ];
  return (
    <div className="min-h-screen">
      <a href="#main-content" className="skip-link">
        {t('skip')}
      </a>
      <header className="border-b border-stone-200/80 bg-[#faf9f5]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-12">
          <Link
            href="/"
            aria-label={t('home')}
            className="flex items-center gap-3 text-xl font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-full bg-emerald-900 text-sm text-white"
            >
              Gm
            </span>
            Gloom
            <span className="hidden text-xs font-normal tracking-normal text-stone-500 lg:inline">
              {t('tagline')}
            </span>
          </Link>
          <nav
            aria-label={t('navigation')}
            className="order-3 flex w-full gap-1 rounded-xl bg-stone-100 p-1 sm:order-0 sm:w-auto"
          >
            {links.map((link) => (
              <Link
                key={link.id}
                href={link.href}
                aria-current={active === link.id ? 'page' : undefined}
                className={`min-h-10 rounded-lg px-5 py-2 text-sm font-medium ${active === link.id ? 'bg-white shadow-sm' : 'text-stone-500 hover:text-stone-900'}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Link
            href={mode === 'demo' ? '/wardrobe' : '/demo'}
            className="text-sm text-stone-600 underline-offset-4 hover:underline"
          >
            {mode === 'demo' ? t('myWardrobe') : t('demoLink')}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <Badge className={mode === 'demo' ? 'bg-emerald-50 text-emerald-800' : ''}>
            {mode === 'demo' ? t('demo') : t('personal')}
          </Badge>
          <span className="text-xs text-stone-500">
            {mode === 'demo' ? t('demoHint') : t('personalHint')}
          </span>
        </div>
        {children}
      </main>
      <footer className="mx-auto mt-8 flex max-w-7xl flex-wrap justify-between gap-3 border-t border-stone-200 px-5 py-6 text-xs text-stone-500 sm:px-8 lg:px-12">
        <span>{t('footer')}</span>
        <span>{mode === 'demo' ? t('illustrations') : t('storage')}</span>
      </footer>
    </div>
  );
}
