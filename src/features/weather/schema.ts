import { z } from 'zod';

const temperatureRange = z.object({ min: z.number(), max: z.number() });
export const weatherSnapshotSchema = z.object({
  status: z.enum(['fresh', 'stale', 'unavailable']),
  locationVersion: z.number().int().nonnegative(),
  placeId: z.string(),
  fetchedAt: z.iso.datetime().nullable(),
  period: z.object({ start: z.iso.datetime(), end: z.iso.datetime(), timezone: z.string() }),
  current: z.object({
    time: z.iso.datetime(), intervalSeconds: z.number().int().positive(),
    temperature: z.number(), apparentTemperature: z.number(), weatherCode: z.number().int(),
    isDay: z.boolean(), windSpeed: z.number(), windGusts: z.number(), precipitation: z.number(),
  }).nullable(),
  summary: z.object({
    temperature: temperatureRange, apparentTemperature: temperatureRange,
    windSpeedMax: z.number(), windGustsMax: z.number(), precipitationMm: z.number(),
    precipitationProbabilityMax: z.number(),
    precipitationPeriod: z.object({ start: z.iso.datetime(), end: z.iso.datetime() }),
  }).nullable(),
  message: z.string().nullable(),
});
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;
