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
  const client = useQueryClient();
  const manualIntent = useRef(false);
  const ipAttempted = useRef(false);
  const ipController = useRef<AbortController | null>(null);
  const [ipNotice, setIpNotice] = useState<string | null>(null);
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
    mutationFn: ({ place, query }: { place: Place; query: string }) =>
      locationClient.save({
        source: 'manual',
        placeId: place.id,
        query,
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
      setIpNotice('Определяем приблизительный город…');
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
          setIpNotice('Не удалось определить город. Выберите его вручную.');
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
      <p className="mb-3 text-xs tracking-[0.2em] text-emerald-800 uppercase">Что надеть сегодня</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Образы на день</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500">
        Выберите город и проверьте погоду перед выходом.
      </p>
      {(locationQuery.error || (!location && initialError)) && (
        <div role="alert" className="mt-5 space-y-3 rounded-xl bg-red-50 p-4 text-sm text-red-800">
          <p>{locationQuery.error?.message ?? initialError}</p>
          <Button
            variant="outline"
            disabled={locationQuery.isFetching}
            onClick={() => locationQuery.refetch()}
          >
            Повторить загрузку места
          </Button>
        </div>
      )}
      {locationQuery.isPending && (
        <p role="status" className="mt-5 text-sm text-stone-500">
          Загружаем выбранное место…
        </p>
      )}
      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-5 sm:p-6">
          <h2 className="text-xl font-semibold">Где вы планируете выйти?</h2>
          {location?.place ? (
            <div className="mt-4 rounded-xl bg-[#efeee7] p-4">
              <p className="font-semibold">{placeLabel(location.place)}</p>
              <p className="mt-2 text-xs text-stone-500">
                {location.source === 'manual'
                  ? 'Выбрано вручную'
                  : 'Приблизительно по IP — проверьте город'}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-stone-500">
              Выберите место, чтобы получить прогноз.
            </p>
          )}
          {ipNotice && (
            <p role="status" className="mt-4 text-sm text-stone-500">
              {ipNotice}
            </p>
          )}
          <LocationSearch
            busy={save.isPending || !location}
            onManualIntent={beginManual}
            onSelect={(place, query) => {
              beginManual();
              save.mutate({ place, query });
            }}
          />
          {save.isPending && (
            <p role="status" className="mt-4 text-sm text-stone-500">
              Сохраняем выбранный город…
            </p>
          )}
          {save.error && (
            <div role="alert" className="mt-4 space-y-3 text-sm text-red-800">
              <p>{save.error.message}</p>
              {conflict && (
                <>
                  <p>
                    Место изменилось. Ваш поиск сохранён; загрузите актуальное место и повторите
                    выбор.
                  </p>
                  <Button
                    variant="outline"
                    disabled={locationQuery.isFetching}
                    onClick={reloadLocation}
                  >
                    Загрузить актуальное место
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
                  Загружаем погоду…
                </p>
              )}
              {weatherQuery.error && (
                <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
                  <p>{weatherQuery.error.message}</p>
                  {weatherQuery.error instanceof LocationApiError &&
                    weatherQuery.error.status === 409 && (
                      <Button className="mt-3" variant="outline" onClick={reloadLocation}>
                        Загрузить актуальное место
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
                {weatherQuery.isFetching ? 'Обновляем погоду…' : 'Обновить погоду'}
              </Button>
            </>
          )}
          {!location?.place && (
            <Card className="bg-[#efeee7] p-6 text-sm leading-6 text-stone-600">
              Прогноз появится после выбора города.
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
