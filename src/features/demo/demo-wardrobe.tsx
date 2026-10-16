'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n/provider';
import { demoMessages } from '@/i18n/messages/demo';
import { getDemoItems } from './fixtures';
import { GarmentCard } from './garment-card';

export function DemoWardrobe() {
  const { locale, t } = useI18n(demoMessages);
  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-xs tracking-[0.2em] text-emerald-800 uppercase">
            {t('wardrobeEyebrow')}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t('wardrobeTitle')}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500">{t('wardrobeIntro')}</p>
        </div>
        <Button asChild>
          <Link href="/demo">{t('choose')} →</Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {getDemoItems(locale).map((item) => (
          <GarmentCard item={item} key={item.id} />
        ))}
      </div>
      <p className="mt-6 text-xs leading-5 text-stone-500">{t('wardrobeNote')}</p>
    </>
  );
}
