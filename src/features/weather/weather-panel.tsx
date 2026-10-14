import { Card } from '@/components/ui/card';
import type { WeatherSnapshot } from './schema';

export function formatWeatherTime(time: string, timezone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
    hour12: false,
  }).format(new Date(time));
}
const number = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
const range = ({ min, max }: { min: number; max: number }) => `${number(min)}…${number(max)} °C`;
// Open-Meteo's WMO interpretation codes: https://open-meteo.com/en/docs
const weatherDescriptions: Readonly<Record<number, string>> = {
  0: 'Ясно',
  1: 'Преимущественно ясно',
  2: 'Переменная облачность',
  3: 'Пасмурно',
  45: 'Туман',
  48: 'Туман с изморозью',
  51: 'Морось',
  53: 'Морось',
  55: 'Морось',
  56: 'Переохлаждённая морось',
  57: 'Переохлаждённая морось',
  61: 'Дождь',
  63: 'Дождь',
  65: 'Дождь',
  66: 'Ледяной дождь',
  67: 'Ледяной дождь',
  71: 'Снег',
  73: 'Снег',
  75: 'Снег',
  77: 'Снежные зёрна',
  80: 'Ливень',
  81: 'Ливень',
  82: 'Ливень',
  85: 'Снежный ливень',
  86: 'Снежный ливень',
  95: 'Гроза',
  96: 'Гроза с градом',
  97: 'Сильная гроза',
  99: 'Гроза с градом',
};

export function WeatherPanel({ weather, now }: { weather: WeatherSnapshot; now: number }) {
  const { current, summary, period } = weather;
  const time = (value: string) => formatWeatherTime(value, period.timezone);
  const aged =
    weather.status === 'fresh' &&
    (!weather.fetchedAt ||
      Date.parse(weather.fetchedAt) + 15 * 60_000 <= now ||
      Date.parse(period.end) <= now);
  const stale = weather.status === 'stale' || aged;
  return (
    <Card role="region" aria-label="Погода для выбранного места" className="space-y-5 p-5 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold">Погода сейчас и на ближайшие 3 часа</h2>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          {time(period.start)} — {time(period.end)} · {period.timezone}
        </p>
      </div>
      {stale && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Устаревшие данные
        </p>
      )}
      {aged && (
        <p role="status" className="text-sm leading-6 text-stone-600">
          Прогноз устарел. Обновите погоду перед выходом.
        </p>
      )}
      {weather.status === 'unavailable' && (
        <p className="font-semibold text-stone-600">Погода недоступна</p>
      )}
      {weather.message && (
        <p role="status" className="text-sm leading-6 text-stone-600">
          {weather.message}
        </p>
      )}
      {current && (
        <div className="rounded-2xl bg-[#efeee7] p-5">
          <p className="text-xs text-stone-500">Текущие условия на {time(current.time)}</p>
          <p className="mt-3 text-4xl font-semibold">{number(current.temperature)} °C</p>
          <p className="mt-2 font-semibold">
            {weatherDescriptions[current.weatherCode] ?? 'Погодные условия не уточнены'}
          </p>
          <p className="mt-2 text-sm">Ощущается как {number(current.apparentTemperature)} °C</p>
          <p className="mt-3 text-sm text-stone-600">
            Ветер {number(current.windSpeed)} км/ч · порывы до {number(current.windGusts)} км/ч
          </p>
        </div>
      )}
      {summary && (
        <div className="space-y-4 text-sm">
          <div>
            <h3 className="font-semibold">Ближайшие 3 часа</h3>
            <p className="mt-2 text-xs leading-5 text-stone-500">
              Ориентировочная оценка по почасовому прогнозу.
            </p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-stone-500">Температура</dt>
                <dd className="mt-1 font-semibold">{range(summary.temperature)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Ощущается как</dt>
                <dd className="mt-1 font-semibold">{range(summary.apparentTemperature)}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Ветер до</dt>
                <dd className="mt-1 font-semibold">{number(summary.windSpeedMax)} км/ч</dd>
              </div>
            </dl>
          </div>
          <div
            role="group"
            aria-label="Осадки и порывы по часовым интервалам"
            className="border-t border-stone-200 pt-4"
          >
            <p className="text-xs leading-5 text-stone-500">
              Осадки и порывы по часовым интервалам: {time(summary.precipitationPeriod.start)} —{' '}
              {time(summary.precipitationPeriod.end)}
            </p>
            <p className="mt-2">Порывы до {number(summary.windGustsMax)} км/ч</p>
            <p className="mt-2">
              {number(summary.precipitationMm)} мм · вероятность до{' '}
              {number(summary.precipitationProbabilityMax)}%
            </p>
          </div>
        </div>
      )}
      <div className="border-t border-stone-200 pt-4 text-xs leading-5 text-stone-500">
        {weather.fetchedAt && <p>Получено {time(weather.fetchedAt)}</p>}
        <p>
          Данные:{' '}
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
