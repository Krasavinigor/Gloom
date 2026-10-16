'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { getErrorMessage } from '@/i18n/errors';
import { outfitMessages } from '@/i18n/messages/outfits';
import { localeTag, type Locale } from '@/i18n/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { WeatherBackground } from '@/features/backgrounds/weather-background';
import { recognitionClient } from '@/features/recognition/client';
import { useOperationEvents } from '@/features/recognition/use-operation-events';
import { Photo } from '@/features/wardrobe/photo-upload';
import type { WeatherSnapshot } from '@/features/weather/schema';
import type { OperationSnapshot } from '@/server/operations/schema';
import type { OutfitState } from '@/server/outfits/repository';
import type { OutfitRole, ValidatedOutfit } from './schema';
import { outfitClient, OutfitApiError } from './client';

const resultKey = ['outfit-result'] as const;
const budgetKey = ['ai-budget'] as const;
const isActive = (value: OperationSnapshot) => ['queued', 'running'].includes(value.status);
export function OutfitPanel({
  initialResult,
  aiEnabled = false,
  now,
  contextWeather,
}: {
  initialResult?: OutfitState;
  aiEnabled?: boolean;
  now?: number;
  contextWeather?: WeatherSnapshot;
}) {
  const { locale, t } = useI18n(outfitMessages);
  const client = useQueryClient();
  const [operation, setOperation] = useState<OperationSnapshot | null>(null);
  const key = useRef<string | null>(null);
  const dispatching = useRef(false);
  const completed = useRef(new Set<string>());
  const result = useQuery({
    queryKey: resultKey,
    queryFn: outfitClient.get,
    initialData: initialResult,
    enabled: aiEnabled || !!initialResult,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const budget = useQuery({
    queryKey: budgetKey,
    queryFn: recognitionClient.budget,
    enabled: aiEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const operationId = operation?.id ?? result.data?.activeOperationId ?? null;
  const start = useMutation({
    mutationFn: outfitClient.start,
    retry: false,
    networkMode: 'always',
    onSuccess: async (snapshot) => {
      await client.cancelQueries({ queryKey: resultKey, exact: true });
      client.setQueryData<OutfitState>(resultKey, (current) =>
        current ? { ...current, activeOperationId: snapshot.id } : current,
      );
      setOperation(snapshot);
      client.invalidateQueries({ queryKey: budgetKey });
    },
    onSettled: () => {
      dispatching.current = false;
    },
  });
  const connection = useOperationEvents(operationId ? [operationId] : [], (snapshot) => {
    if (snapshot.id !== operationId) return;
    setOperation((current) =>
      current && current.statusRevision >= snapshot.statusRevision ? current : snapshot,
    );
    if (!isActive(snapshot) && !completed.current.has(snapshot.id)) {
      completed.current.add(snapshot.id);
      key.current = null;
      client.invalidateQueries({ queryKey: resultKey });
      client.invalidateQueries({ queryKey: budgetKey });
    }
  });
  const active = !!operationId && (!operation || isActive(operation));
  const exhausted = !!budget.data && budget.data.remainingMicroUsd <= 0;
  const weatherStale =
    !!contextWeather &&
    (contextWeather.status !== 'fresh' ||
      !contextWeather.fetchedAt ||
      (now !== undefined &&
        (Date.parse(contextWeather.fetchedAt) + 15 * 60_000 <= now ||
          Date.parse(contextWeather.period.end) <= now)));
  function select() {
    if (
      dispatching.current ||
      start.isPending ||
      active ||
      !budget.data ||
      exhausted ||
      weatherStale
    )
      return;
    dispatching.current = true;
    key.current ??= crypto.randomUUID();
    start.mutate(key.current);
  }
  const persisted = result.data;
  const expired =
    !!persisted?.result &&
    now !== undefined &&
    Date.parse(persisted.result.snapshot.weather.period.end) <= now;
  const state =
    (expired || weatherStale) && persisted
      ? {
          ...persisted,
          stale: true,
          staleReasons: [
            ...new Set([
              ...persisted.staleReasons,
              ...(expired ? ['Период подбора закончился.'] : []),
              ...(weatherStale ? ['Обновите погоду перед новым подбором.'] : []),
            ]),
          ],
        }
      : persisted;
  return (
    <section aria-label={t('section')} className="mt-7">
      <WeatherBackground presetId={state?.result?.backgroundPresetId} stale={state?.stale ?? true}>
        <div className="space-y-5 p-5 sm:p-6">
          <h2 className="text-xl font-semibold">{t('heading')}</h2>
          <p className="text-sm leading-6 text-stone-600">{t('intro')}</p>
          {!aiEnabled && <p className="text-sm text-stone-600">{t('disabled')}</p>}
          {budget.data && (
            <p className="text-xs text-stone-600">
              {t('budget', {
                month: budget.data.month,
                confirmed: new Intl.NumberFormat(localeTag(locale), {
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4,
                }).format(budget.data.confirmedCostMicroUsd / 1_000_000),
                limit: new Intl.NumberFormat(localeTag(locale), {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(budget.data.limitMicroUsd / 1_000_000),
                reserved: new Intl.NumberFormat(localeTag(locale), {
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4,
                }).format(
                  (budget.data.activeReservedMicroUsd + budget.data.unknownReservedMicroUsd) /
                    1_000_000,
                ),
              })}
            </p>
          )}
          {budget.data?.warning && !exhausted && (
            <p role="status" className="text-sm text-amber-900">
              {t('budgetWarning')}
            </p>
          )}
          {exhausted && (
            <p role="status" className="text-sm text-amber-900">
              {t('exhausted')}
            </p>
          )}
          {budget.error && (
            <div role="alert" className="space-y-2 text-sm text-red-800">
              <p>{t('budgetError')}</p>
              <Button
                variant="outline"
                disabled={budget.isFetching}
                onClick={() => budget.refetch()}
              >
                {t('checkBudget')}
              </Button>
            </div>
          )}
          {result.error && (
            <div role="alert" className="space-y-2 text-sm text-red-800">
              <p>{getErrorMessage(locale, result.error)}</p>
              <Button
                variant="outline"
                disabled={result.isFetching}
                onClick={() => result.refetch()}
              >
                {t('refreshResult')}
              </Button>
            </div>
          )}
          {weatherStale && (
            <p role="status" className="text-sm text-amber-900">
              {t('weatherStale')}
            </p>
          )}
          {start.error && (
            <p role="alert" className="text-sm text-red-800">
              {getErrorMessage(locale, start.error)}
            </p>
          )}
          {active && (
            <p role="status" className="text-sm text-emerald-900">
              {operation?.status === 'running' ? t('running') : t('queued')}
            </p>
          )}
          {active && ['connecting', 'reconnecting'].includes(connection) && (
            <p className="text-xs text-stone-600">{t('reconnecting')}</p>
          )}
          {operation && !isActive(operation) && operation.status !== 'succeeded' && (
            <div role="status" className="space-y-2 text-sm text-amber-900">
              <p>
                {operation.status === 'timed_out'
                  ? t('timedOut')
                  : operation.status === 'interrupted'
                    ? t('interrupted')
                    : t('failed')}
              </p>
              {operation.settlementState === 'unknown' && <p>{t('unknownPayment')}</p>}
            </div>
          )}
          {aiEnabled && (
            <Button
              disabled={
                active ||
                start.isPending ||
                !budget.data ||
                exhausted ||
                !!budget.error ||
                weatherStale
              }
              onClick={select}
            >
              {start.isPending
                ? t('starting')
                : active
                  ? t('active')
                  : start.error
                    ? t('checkLaunch')
                    : t('select')}
            </Button>
          )}
          {state?.stale && (
            <div role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">{t('stale')}</p>
              <ul className="mt-2 list-disc pl-5">
                {state.staleReasons.map((reason) => (
                  <li key={reason}>{staleReason(reason, t)}</li>
                ))}
              </ul>
            </div>
          )}
          {state?.result && (
            <div className="grid gap-4 xl:grid-cols-3">
              {state.result.outfits.map((outfit) => (
                <OutfitCard key={outfit.id} outfit={outfit} state={state} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/wardrobe">{t('wardrobe')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/demo">{t('demo')}</Link>
            </Button>
          </div>
        </div>
      </WeatherBackground>
    </section>
  );
}
function OutfitCard({ outfit, state }: { outfit: ValidatedOutfit; state: OutfitState }) {
  const { locale, t } = useI18n(outfitMessages);
  const garments = state.result!.snapshot.garments;
  return (
    <Card className="min-w-0 space-y-4 p-4">
      <h3 className="text-lg font-semibold">{outfit.title}</h3>
      {outfit.conditional && (
        <p className="text-sm font-medium text-amber-900">{t('conditional')}</p>
      )}
      <p className="text-sm leading-6 text-stone-600">
        {outfit.explanationSource === 'replacement' ? t('replacementChecked') : outfit.explanation}
      </p>
      {!!outfit.warnings.length && (
        <ul className="list-disc space-y-2 pl-5 text-sm text-amber-900">
          {outfit.warnings.map((warning, index) => (
            <li key={`${warning.code}:${index}`}>{warningLabel(warning, state, t, locale)}</li>
          ))}
        </ul>
      )}
      <div className="space-y-4">
        {outfit.items.map((item) => {
          const garment = garments.find((candidate) => candidate.id === item.garmentId);
          const available = garment && !state.unavailableGarmentIds.includes(item.garmentId);
          return (
            <div key={item.role} className="rounded-xl border border-stone-200 p-3">
              <p className="mb-2 text-xs text-stone-500">{t(`role_${item.role}`)}</p>
              {available ? (
                <>
                  <Photo src={`/api/assets/${garment.photoId}`} alt={garment.fields.name} />
                  <p className="mt-2 text-sm font-medium">{garment.fields.name}</p>
                </>
              ) : (
                <p className="text-sm text-stone-500">{t('unavailable')}</p>
              )}
              {!state.stale && available && <Replacement outfitId={outfit.id} slot={item.role} />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
function Replacement({ outfitId, slot }: { outfitId: string; slot: OutfitRole }) {
  const { locale, t } = useI18n(outfitMessages);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const candidates = useQuery({
    queryKey: ['outfit-alternatives', outfitId, slot],
    queryFn: () => outfitClient.alternatives(outfitId, slot),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const replace = useMutation({
    mutationFn: () => outfitClient.replace(outfitId, slot, selected, candidates.data!.revision),
    retry: false,
    networkMode: 'always',
    onSuccess: (value) => {
      client.setQueryData(resultKey, value);
      client.invalidateQueries({ queryKey: ['outfit-alternatives'] });
      setOpen(false);
      setSelected('');
    },
  });
  const conflict = replace.error instanceof OutfitApiError && replace.error.status === 409;
  return (
    <div className="mt-3 space-y-3">
      <Button
        size="sm"
        variant="outline"
        disabled={replace.isPending}
        onClick={() => {
          setOpen(!open);
          replace.reset();
        }}
      >
        {' '}
        {open ? t('closeReplacement') : t('replace', { role: t(`role_${slot}`) })}{' '}
      </Button>
      {open && (
        <>
          <p className="text-xs leading-5 text-stone-500">{t('replacementIntro')}</p>
          {candidates.isPending && (
            <p role="status" className="text-sm">
              {t('checking')}
            </p>
          )}
          {candidates.error && (
            <p role="alert" className="text-sm text-red-800">
              {getErrorMessage(locale, candidates.error)}
            </p>
          )}
          {candidates.data &&
            (candidates.data.candidates.length ? (
              <>
                <label className="block text-sm">
                  {t('replacement', { role: t(`role_${slot}`) })}
                  <select
                    className="mt-2 block w-full rounded-lg border border-stone-300 bg-white p-2"
                    value={selected}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      replace.reset();
                    }}
                  >
                    <option value="">{t('choose')}</option>
                    {candidates.data.candidates.map((garment) => (
                      <option key={garment.id} value={garment.id}>
                        {garment.fields.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  disabled={!selected || replace.isPending || candidates.isFetching || conflict}
                  onClick={() => replace.mutate()}
                >
                  {replace.isPending ? t('replacing') : t('apply')}
                </Button>
              </>
            ) : (
              <p className="text-sm text-stone-500">{t('empty')}</p>
            ))}
          {replace.error && (
            <div role="alert" className="space-y-2 text-sm text-red-800">
              <p>{getErrorMessage(locale, replace.error)}</p>
              {conflict && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await client.invalidateQueries({ queryKey: resultKey });
                    await candidates.refetch();
                    setSelected('');
                    replace.reset();
                  }}
                >
                  {t('refreshAlternatives')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type OutfitTranslator = ReturnType<typeof useI18n<typeof outfitMessages>>['t'];
function staleReason(reason: string, t: OutfitTranslator): string {
  const keys = {
    'Гардероб изменился.': 'wardrobeChanged',
    'Выбрано другое место.': 'locationChanged',
    'Период подбора закончился.': 'periodEnded',
    'Свежая погода недоступна.': 'freshUnavailable',
    'Погодные условия изменились.': 'conditionsChanged',
    'Обновите погоду перед новым подбором.': 'refreshBeforeNew',
  } as const;
  return t(keys[reason as keyof typeof keys] ?? 'dataChanged');
}
function warningLabel(
  warning: ValidatedOutfit['warnings'][number],
  state: OutfitState,
  t: OutfitTranslator,
  locale: Locale,
): string {
  const number = (value: number) => new Intl.NumberFormat(localeTag(locale)).format(value);
  const garment = state.result!.snapshot.garments.find((item) => item.id === warning.garmentId);
  if (warning.code === 'RAIN_PROTECTION')
    return garment
      ? t(garment.fields.rainProtection === 'absent' ? 'rainItemAbsent' : 'rainItemUnknown', {
          name: garment.fields.name,
        })
      : t('rainUnknown');
  if (warning.code === 'REMOVABLE_LAYER') return t('removable');
  const range = state.result!.snapshot.weather.summary?.apparentTemperature;
  const temperature = garment?.fields.temperature;
  return garment && range && temperature
    ? t('temperatureRange', {
        name: garment.fields.name,
        min: number(range.min),
        max: number(range.max),
        itemMin: number(temperature.min),
        itemMax: number(temperature.max),
      })
    : t('temperatureGeneric');
}
