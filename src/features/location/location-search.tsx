'use client';
import { useState } from 'react';
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
  onSelect: (place: Place, query: string) => void;
  onManualIntent: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const search = useMutation({
    mutationFn: async (value: string) => ({
      query: value,
      places: await locationClient.search(value),
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
          search.mutate(parsed.data);
        }}
      >
        <label htmlFor="city-search" className="block text-sm font-semibold">
          Город
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="city-search"
            value={query}
            minLength={2}
            maxLength={100}
            autoComplete="off"
            placeholder="Например, Москва"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            onChange={(event) => {
              onManualIntent();
              setQuery(event.target.value);
              search.reset();
            }}
          />
          <Button type="submit" disabled={!parsed.success || search.isPending || busy}>
            {search.isPending ? 'Ищем…' : 'Найти город'}
          </Button>
        </div>
        <p className="text-xs leading-5 text-stone-500">
          Введите минимум два символа и выберите город из результатов.
        </p>
      </form>
      {search.error && (
        <p role="alert" className="mt-4 text-sm text-red-800">
          {search.error.message}
        </p>
      )}
      {results?.length === 0 && (
        <p role="status" className="mt-4 text-sm text-stone-500">
          Город не найден. Попробуйте другое название.
        </p>
      )}
      {!!results?.length && (
        <ul aria-label="Найденные города" className="mt-4 space-y-2">
          {results.map((place) => (
            <li key={place.id}>
              <Button
                className="w-full justify-start text-left whitespace-normal"
                variant="outline"
                disabled={busy}
                aria-label={`Выбрать ${placeLabel(place)}`}
                onClick={() => onSelect(place, search.data!.query)}
              >
                {placeLabel(place)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-5 text-stone-500">
        Поиск мест:{' '}
        <a
          href="https://open-meteo.com/en/docs/geocoding-api"
          target="_blank"
          rel="noreferrer"
          aria-label="Open-Meteo: поиск мест"
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
