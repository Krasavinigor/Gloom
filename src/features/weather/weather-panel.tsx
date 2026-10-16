'use client';
import { useI18n } from '@/i18n/provider';
import { localeTag, type Locale } from '@/i18n/core';
import { locationWeatherMessages } from '@/i18n/messages/location-weather';
import { Card } from '@/components/ui/card';
import type { WeatherSnapshot } from './schema';

export function formatWeatherTime(time: string, timezone: string, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
    hour12: false,
  }).format(new Date(time));
}
const weatherKeys = {
  0: 'clear',
  1: 'mostlyClear',
  2: 'partlyCloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rimeFog',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  56: 'freezingDrizzle',
  57: 'freezingDrizzle',
  61: 'rain',
  63: 'rain',
  65: 'rain',
  66: 'freezingRain',
  67: 'freezingRain',
  71: 'snow',
  73: 'snow',
  75: 'snow',
  77: 'snowGrains',
  80: 'showers',
  81: 'showers',
  82: 'showers',
  85: 'snowShowers',
  86: 'snowShowers',
  95: 'thunderstorm',
  96: 'hail',
  97: 'heavyThunderstorm',
  99: 'hail',
} as const;

export function WeatherPanel({ weather, now }: { weather: WeatherSnapshot; now: number }) {
  const { locale, t } = useI18n(locationWeatherMessages);
  const number = (value: number) =>
    new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 1 }).format(value);
  const range = ({ min, max }: { min: number; max: number }) => `${number(min)}…${number(max)} °C`;
  const { current, summary, period } = weather;
  const time = (value: string) => formatWeatherTime(value, period.timezone, locale);
  const aged =
    weather.status === 'fresh' &&
    (!weather.fetchedAt ||
      Date.parse(weather.fetchedAt) + 15 * 60_000 <= now ||
      Date.parse(period.end) <= now);
  const stale = weather.status === 'stale' || aged;
  return (
    <Card role="region" aria-label={t('weatherLabel')} className="space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold">{t('heading')}</h2>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          {time(period.start)} — {time(period.end)} · {period.timezone}
        </p>
      </div>
      {stale && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          {t('stale')}
        </p>
      )}
      {aged && (
        <p role="status" className="text-sm leading-6 text-stone-600">
          {t('aged')}
        </p>
      )}
      {weather.status === 'unavailable' && (
        <p className="font-semibold text-stone-600">{t('unavailable')}</p>
      )}
      {weather.message && (
        <p role="status" className="text-sm leading-6 text-stone-600">
          {t(weather.status === 'stale' ? 'staleMessage' : 'unavailableMessage')}
        </p>
      )}
      {current && (
        <div className="rounded-2xl bg-[#efeee7] p-5">
          <p className="text-xs text-stone-500">{t('currentAt', { time: time(current.time) })}</p>
          <p className="mt-3 text-4xl font-semibold">{number(current.temperature)} °C</p>
          <p className="mt-2 font-semibold">
            {t(weatherKeys[current.weatherCode as keyof typeof weatherKeys] ?? 'unknownWeather')}
          </p>
          <p className="mt-2 text-sm">
            {t('feelsLike', { temperature: number(current.apparentTemperature) })}
          </p>
          <p className="mt-3 text-sm text-stone-600">
            {t('wind', { speed: number(current.windSpeed), gusts: number(current.windGusts) })}
          </p>
        </div>
      )}
      {summary && (
        <div className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold">{t('upcoming')}</h3>
            <p className="mt-2 text-xs leading-5 text-stone-500">{t('estimate')}</p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-stone-500">{t('temperature')}</dt>
                <dd className="mt-1 font-semibold">{range(summary.temperature)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">{t('apparentTemperature')}</dt>
                <dd className="mt-1 font-semibold">{range(summary.apparentTemperature)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">{t('windUpTo')}</dt>
                <dd className="mt-1 font-semibold">
                  {number(summary.windSpeedMax)} {t('windUnit')}
                </dd>
              </div>
            </dl>
          </div>
          <div
            role="group"
            aria-label={t('intervalsLabel')}
            className="border-t border-stone-200 pt-4"
          >
            <p className="text-xs leading-5 text-stone-500">
              {t('intervals', {
                start: time(summary.precipitationPeriod.start),
                end: time(summary.precipitationPeriod.end),
              })}
            </p>
            <p className="mt-2">{t('gusts', { gusts: number(summary.windGustsMax) })}</p>
            <p className="mt-2">
              {t('precipitation', {
                amount: number(summary.precipitationMm),
                probability: number(summary.precipitationProbabilityMax),
              })}
            </p>
          </div>
        </div>
      )}
      <div className="border-t border-stone-200 pt-4 text-xs leading-5 text-stone-500">
        {weather.fetchedAt && <p>{t('fetchedAt', { time: time(weather.fetchedAt) })}</p>}
        <p>
          {t('data')}{' '}
          <a
            className="underline underline-offset-2"
            href="https://open-meteo.com/"
            target="_blank"
            rel="noreferrer"
          >
            Open-Meteo
          </a>
        </p>
      </div>
    </Card>
  );
}
