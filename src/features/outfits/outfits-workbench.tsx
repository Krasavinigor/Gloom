'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { locationClient, LocationApiError } from '../location/client';
import { LocationSearch, placeLabel } from '../location/location-search';
import { detectIpLocation } from '../location/ip-location';
import type { LocationState, Place } from '../location/schema';
import { WeatherPanel } from '../weather/weather-panel';
import type { WeatherSnapshot } from '../weather/schema';
import type { OutfitState } from '@/server/outfits/repository';
import { OutfitPanel } from './outfit-panel';
import { useI18n } from '@/i18n/provider';
import { getErrorMessage } from '@/i18n/errors';
import type { Locale } from '@/i18n/core';
import { outfitMessages } from '@/i18n/messages/outfits';

const locationKey = ['personal-location'] as const;

export function OutfitsWorkbench({
  initialLocation,
  initialWeather,
  initialError,
  initialNow,
  initialResult,
  aiEnabled = false,
}: {
  initialLocation?: LocationState;
  initialWeather?: WeatherSnapshot;
  initialError?: string;
  initialNow?: number;
  initialResult?: OutfitState;
  aiEnabled?: boolean;
}) {
  const { locale, t } = useI18n(outfitMessages);
  const client = useQueryClient();
  const manualIntent = useRef(false);
  const ipAttempted = useRef(false);
  const ipController = useRef<AbortController | null>(null);
  const [ipNotice, setIpNotice] = useState<'detecting' | 'ipFailed' | null>(null);
  const [now, setNow] = useState(() => initialNow ?? Date.now());
  useEffect(() => {
    const initialTick = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(initialTick);
      clearInterval(timer);
    };
  }, []);
  const locationQuery = useQuery({
    queryKey: locationKey,
    queryFn: locationClient.get,
    initialData: initialLocation,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const location = locationQuery.data;
  const weatherQuery = useQuery({
    queryKey: ['personal-weather', location?.place?.id, location?.locationVersion],
    queryFn: ({ signal }) => locationClient.weather(location!.locationVersion, signal),
    enabled: !!location?.place,
    initialData:
      initialWeather?.locationVersion === location?.locationVersion &&
      initialWeather?.placeId === location?.place?.id
        ? initialWeather
        : undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const save = useMutation({
    mutationFn: ({
      place,
      query,
      searchLocale,
    }: {
      place: Place;
      query: string;
      searchLocale: Locale;
    }) =>
      locationClient.save({
        source: 'manual',
        placeId: place.id,
        query,
        searchLocale,
        expectedVersion: location!.locationVersion,
      }),
    onSuccess: (state) => {
      client.setQueryData(locationKey, state);
    },
  });

  useEffect(() => {
    if (!location || location.place || manualIntent.current || ipAttempted.current) return;
    const controller = new AbortController();
    ipController.current = controller;
    // Defer starting until after StrictMode's setup/cleanup probe.
    queueMicrotask(async () => {
      if (controller.signal.aborted || manualIntent.current) return;
      ipAttempted.current = true;
      setIpNotice('detecting');
      try {
        const candidate = await detectIpLocation(controller.signal);
        if (controller.signal.aborted || manualIntent.current) return;
        const state = await locationClient.save(
          {
            source: 'ip',
            candidate,
            expectedVersion: location.locationVersion,
          },
          controller.signal,
        );
        if (controller.signal.aborted || manualIntent.current) return;
        client.setQueryData(locationKey, state);
        setIpNotice(null);
      } catch {
        if (!controller.signal.aborted && !manualIntent.current) {
          setIpNotice('ipFailed');
        }
      }
    });
    return () => controller.abort();
  }, [location, client]);

  function beginManual() {
    manualIntent.current = true;
    ipController.current?.abort();
    setIpNotice(null);
    save.reset();
  }
  async function reloadLocation() {
    const result = await locationQuery.refetch();
    if (!result.error) save.reset();
  }
  const weather = weatherQuery.data;
  const contextKey = `${location?.locationVersion}:${weather?.fetchedAt}:${weather?.status}`;
  const previousContext = useRef(contextKey);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    client.invalidateQueries({ queryKey: ['outfit-result'] });
  }, [client, contextKey]);
  const conflict = save.error instanceof LocationApiError && save.error.status === 409;
  return (
    <>
      <p className="mb-3 text-xs tracking-[0.2em] text-emerald-800 uppercase">{t('eyebrow')}</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t('pageHeading')}</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500">{t('pageIntro')}</p>
      {(locationQuery.error || (!location && initialError)) && (
        <div role="alert" className="mt-5 space-y-3 rounded-xl bg-red-50 p-4 text-sm text-red-800">
          <p>{getErrorMessage(locale, locationQuery.error ?? initialError)}</p>
          <Button
            variant="outline"
            disabled={locationQuery.isFetching}
            onClick={() => locationQuery.refetch()}
          >
            {t('retryLocation')}
          </Button>
        </div>
      )}
      {locationQuery.isPending && (
        <p role="status" className="mt-5 text-sm text-stone-500">
          {t('loadingLocation')}
        </p>
      )}
      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-5 sm:p-6">
          <h2 className="text-xl font-semibold">{t('where')}</h2>
          {location?.place ? (
            <div className="mt-4 rounded-xl bg-[#efeee7] p-4">
              <p className="font-semibold">{placeLabel(location.place)}</p>
              <p className="mt-2 text-xs text-stone-500">
                {location.source === 'manual' ? t('manual') : t('approximate')}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-stone-500">{t('choosePlace')}</p>
          )}
          {ipNotice && (
            <p role="status" className="mt-4 text-sm text-stone-500">
              {t(ipNotice)}
            </p>
          )}
          <LocationSearch
            busy={save.isPending || !location}
            onManualIntent={beginManual}
            onSelect={(place, query, searchLocale) => {
              beginManual();
              save.mutate({ place, query, searchLocale });
            }}
          />
          {save.isPending && (
            <p role="status" className="mt-4 text-sm text-stone-500">
              {t('savingCity')}
            </p>
          )}
          {save.error && (
            <div role="alert" className="mt-4 space-y-3 text-sm text-red-800">
              <p>{getErrorMessage(locale, save.error)}</p>
              {conflict && (
                <>
                  <p>{t('locationConflict')}</p>
                  <Button
                    variant="outline"
                    disabled={locationQuery.isFetching}
                    onClick={reloadLocation}
                  >
                    {t('reloadLocation')}
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
        <div className="min-w-0 space-y-4">
          {location?.place && (
            <>
              {weatherQuery.isPending && (
                <p role="status" className="text-sm text-stone-500">
                  {t('loadingWeather')}
                </p>
              )}
              {weatherQuery.error && (
                <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
                  <p>{getErrorMessage(locale, weatherQuery.error)}</p>
                  {weatherQuery.error instanceof LocationApiError &&
                    weatherQuery.error.status === 409 && (
                      <Button className="mt-3" variant="outline" onClick={reloadLocation}>
                        {t('reloadLocation')}
                      </Button>
                    )}
                </div>
              )}
              {weather && <WeatherPanel weather={weather} now={now} />}
              <Button
                variant="outline"
                disabled={weatherQuery.isFetching}
                onClick={() => weatherQuery.refetch()}
              >
                {weatherQuery.isFetching ? t('refreshingWeather') : t('refreshWeather')}
              </Button>
            </>
          )}
          {!location?.place && (
            <Card className="bg-[#efeee7] p-6 text-sm leading-6 text-stone-600">
              {t('noPlace')}
            </Card>
          )}
        </div>
      </div>
      <OutfitPanel
        initialResult={initialResult}
        aiEnabled={aiEnabled}
        now={now}
        contextWeather={weather}
      />
    </>
  );
}
