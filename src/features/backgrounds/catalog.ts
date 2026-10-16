import type { WeatherSnapshot } from '@/features/weather/schema';

/** Original illustrations bundled with this project, dedicated to the public domain. */
export const backgroundPresets = ([
  { id: 'default', title: 'Спокойный день', group: 'default' },
  { id: 'clear-day', title: 'Ясный день', group: 'clear' },
  { id: 'clear-night', title: 'Ясный вечер', group: 'clear' },
  { id: 'clouds-light', title: 'Небольшая облачность', group: 'cloud' },
  { id: 'clouds-overcast', title: 'Облачный день', group: 'cloud' },
  { id: 'fog', title: 'Туманный день', group: 'fog' },
  { id: 'rain', title: 'Дождливый день', group: 'rain' },
  { id: 'snow', title: 'Снежный день', group: 'snow' },
  { id: 'thunder', title: 'Гроза', group: 'thunder' },
] as const).map((preset) => ({
  ...preset,
  file: `/weather-backgrounds/${preset.id}.svg`,
  source: 'Original project illustration' as const,
  license: 'CC0-1.0' as const,
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
}));

export type BackgroundPresetId = (typeof backgroundPresets)[number]['id'];
export const backgroundPresetIds = backgroundPresets.map((preset) => preset.id);
export function getBackgroundPreset(id: string | null | undefined) {
  return backgroundPresets.find((preset) => preset.id === id) ?? backgroundPresets[0]!;
}

const snowCodes: readonly number[] = [56, 57, 66, 67, 71, 73, 75, 77, 85, 86];
const rainCodes: readonly number[] = [51, 53, 55, 61, 63, 65, 80, 81, 82];
const knownCodes: readonly number[] = [0, 1, 2, 3, 45, 48, ...snowCodes, ...rainCodes, 95, 96, 97, 99];

/** All period codes belong to the same persisted forecast as the outfit result. */
export function selectBackground(weather: WeatherSnapshot): BackgroundPresetId {
  if (weather.status === 'unavailable' || !weather.current) return 'default';
  const codes = [weather.current.weatherCode, ...(weather.summary?.weatherCodes ?? [])];
  if (codes.some((code) => !knownCodes.includes(code))) return 'default';
  if (codes.some((code) => [95, 96, 97, 99].includes(code))) return 'thunder';
  if (codes.some((code) => snowCodes.includes(code))) return 'snow';
  if (codes.some((code) => rainCodes.includes(code))) return 'rain';
  if (codes.some((code) => [45, 48].includes(code))) return 'fog';
  if (codes.includes(3)) return 'clouds-overcast';
  if (codes.some((code) => [1, 2].includes(code))) return 'clouds-light';
  return weather.current.isDay ? 'clear-day' : 'clear-night';
}
