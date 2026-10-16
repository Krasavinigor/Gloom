'use client';

import { useI18n } from '@/i18n/provider';
import { demoMessages } from '@/i18n/messages/demo';
import Link from 'next/link';
import { OutfitCard } from './outfit-card';
import type { DemoScenario } from './fixtures';
import { WeatherBackground } from '@/features/backgrounds/weather-background';

export function DemoHeading() {
  const { t } = useI18n(demoMessages);
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="mb-3 text-xs tracking-[0.2em] text-emerald-800 uppercase">{t('eyebrow')}</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t('heading')}</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500 sm:text-base">{t('intro')}</p>
      </div>
      <Link
        href="/demo/wardrobe"
        className="text-sm font-medium text-emerald-900 underline underline-offset-4"
      >
        {t('wardrobeLink')}
      </Link>
    </div>
  );
}

export function DemoWeather({
  scenario,
  backgroundPresetId = 'default',
}: {
  scenario: DemoScenario;
  backgroundPresetId?: string;
}) {
  const { t } = useI18n(demoMessages);
  const weatherDetails = [
    [t('feelsLike'), scenario.feelsLike],
    [t('wind'), scenario.wind],
    [t('rain'), scenario.rain],
  ];
  return (
    <section
      aria-labelledby="weather-heading"
      className="overflow-hidden rounded-3xl border border-stone-200 bg-[#eae9d5]"
    >
      <WeatherBackground
        presetId={backgroundPresetId}
        className="weather-hero rounded-none p-6 sm:p-8"
      >
        <div className="relative max-w-md">
          <p className="text-xs tracking-[0.16em] text-stone-500 uppercase">
            {t('weatherExample')}
          </p>
          <h2 id="weather-heading" className="mt-3 text-base font-semibold">
            {scenario.label}
          </h2>
          <div className="mt-1 flex items-center gap-5">
            <span className="text-6xl font-medium tracking-tight sm:text-7xl">
              {scenario.temperature}
            </span>
            <span aria-hidden="true" className="text-5xl text-emerald-800">
              {scenario.symbol}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-stone-600">{scenario.description}</p>
        </div>
      </WeatherBackground>
      <dl className="grid grid-cols-3 border-t border-stone-200/80 bg-white/75 px-4 py-5 sm:px-8">
        {weatherDetails.map(([title, value]) => (
          <div key={title} className="border-r border-stone-200 px-2 last:border-0 sm:px-4">
            <dt className="text-xs text-stone-500">{title}</dt>
            <dd className="mt-1 text-sm font-semibold sm:text-base">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DemoResults({ selected, scenario }: { selected: boolean; scenario: DemoScenario }) {
  const { t } = useI18n(demoMessages);
  return (
    <section aria-label={t('results')} aria-live="polite" className="mt-10">
      {selected ? (
        <>
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{t('yourOutfits')}</h2>
            <p className="text-xs text-stone-500">
              {t('variants', { count: scenario.outfits.length })}
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {scenario.outfits.map((outfit, index) => (
              <OutfitCard key={outfit.id} outfit={outfit} index={index} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-dashed border-stone-300 px-6 py-8">
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-full bg-stone-100 text-2xl text-stone-500"
          >
            ↗
          </span>
          <div>
            <h2 className="font-semibold">{t('ready')}</h2>
            <p className="mt-1 text-sm text-stone-500">{t('readyHint')}</p>
          </div>
        </div>
      )}
    </section>
  );
}
