'use client';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import type { Locale } from '@/i18n/core';
import { locationWeatherMessages } from '@/i18n/messages/location-weather';
import { getErrorMessage } from '@/i18n/errors';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { locationClient } from './client';
import { searchQuerySchema, type Place } from './schema';

export const placeLabel = (place: Place) =>
  [place.name, place.region, place.country].filter(Boolean).join(', ');

export function LocationSearch({
  onSelect,
  onManualIntent,
  busy,
}: {
  onSelect: (place: Place, query: string, searchLocale: Locale) => void;
  onManualIntent: () => void;
  busy: boolean;
}) {
  const { locale, t } = useI18n(locationWeatherMessages);
  const [query, setQuery] = useState('');
  const search = useMutation({
    mutationFn: async ({ value, searchLocale }: { value: string; searchLocale: Locale }) => ({
      query: value,
      searchLocale,
      places: await locationClient.search(value, searchLocale),
    }),
  });
  const parsed = searchQuerySchema.safeParse(query);
  const results =
    parsed.success && search.data?.query === parsed.data ? search.data.places : undefined;
  return (
    <>
      <form
        className="mt-5 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!parsed.success) return;
          onManualIntent();
          search.mutate({ value: parsed.data, searchLocale: locale });
        }}
      >
        <label htmlFor="city-search" className="block text-sm font-semibold">
          {t('city')}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="city-search"
            value={query}
            minLength={2}
            maxLength={100}
            autoComplete="off"
            placeholder={t('placeholder')}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            onChange={(event) => {
              onManualIntent();
              setQuery(event.target.value);
              search.reset();
            }}
          />
          <Button type="submit" disabled={!parsed.success || search.isPending || busy}>
            {search.isPending ? t('searching') : t('search')}
          </Button>
        </div>
        <p className="text-xs leading-5 text-stone-500">{t('hint')}</p>
      </form>
      {search.error && (
        <p role="alert" className="mt-4 text-sm text-red-800">
          {getErrorMessage(locale, search.error)}
        </p>
      )}
      {results?.length === 0 && (
        <p role="status" className="mt-4 text-sm text-stone-500">
          {t('noResults')}
        </p>
      )}
      {!!results?.length && (
        <ul aria-label={t('results')} className="mt-4 space-y-2">
          {results.map((place) => (
            <li key={place.id}>
              <Button
                className="w-full justify-start text-left whitespace-normal"
                variant="outline"
                disabled={busy}
                aria-label={t('select', { place: placeLabel(place) })}
                onClick={() => onSelect(place, search.data!.query, search.data!.searchLocale)}
              >
                {placeLabel(place)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-5 text-stone-500">
        {t('searchCredit')}{' '}
        <a
          href="https://open-meteo.com/en/docs/geocoding-api"
          target="_blank"
          rel="noreferrer"
          aria-label={t('searchCreditLabel')}
          className="underline underline-offset-2"
        >
          Open-Meteo
        </a>
        {' / '}
        <a
          href="https://www.geonames.org/"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          GeoNames
        </a>
      </p>
    </>
  );
}
