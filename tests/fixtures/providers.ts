// Synthetic provider responses used only by isolated browser tests.
export const testPlaces = {
  moscow: { id: '524901', name: 'Москва', region: 'Москва', country: 'Россия',
    countryCode: 'RU', latitude: 55.7522, longitude: 37.6156, timezone: 'Europe/Moscow' },
  berlin: { id: '2950159', name: 'Берлин', region: 'Берлин', country: 'Германия',
    countryCode: 'DE', latitude: 52.5244, longitude: 13.4105, timezone: 'Europe/Berlin' },
  tallinn: { id: '588409', name: 'Таллин', region: 'Harju', country: 'Эстония',
    countryCode: 'EE', latitude: 59.437, longitude: 24.7536, timezone: 'Europe/Tallinn' },
} as const;

export function makeForecast(now: number, latitude: number, longitude: number, timezone: string) {
  const start = Math.floor(now / 3_600_000) * 3600 - 24 * 3600;
  const times = Array.from({ length: 96 }, (_, index) => start + index * 3600);
  const values = (value: number) => times.map(() => value);
  const units = { time: 'unixtime', temperature_2m: '°C', apparent_temperature: '°C',
    precipitation: 'mm', weather_code: 'wmo code', wind_speed_10m: 'km/h', wind_gusts_10m: 'km/h' };
  return { latitude, longitude, timezone,
    current_units: { ...units, interval: 'seconds', is_day: '' },
    hourly_units: { ...units, precipitation_probability: '%' },
    current: { time: Math.floor(now / 900_000) * 900, interval: 900,
      temperature_2m: 12, apparent_temperature: 10, precipitation: 0.3,
      weather_code: 3, is_day: 1, wind_speed_10m: 12, wind_gusts_10m: 20 },
    hourly: { time: times, temperature_2m: values(12), apparent_temperature: values(10),
      precipitation: values(0.3), precipitation_probability: values(40), weather_code: values(3),
      wind_speed_10m: values(12), wind_gusts_10m: values(20) },
  };
}
