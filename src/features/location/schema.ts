import { z } from 'zod';

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const label = z.string().trim().min(1).max(150);
export const placeSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: label,
  region: z.string().trim().max(150),
  country: label,
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().trim().min(1).max(100).refine(validTimezone, 'Invalid timezone.'),
}).strict();
export type Place = z.infer<typeof placeSchema>;

export const locationSourceSchema = z.enum(['manual', 'ip']);
export type LocationSource = z.infer<typeof locationSourceSchema>;
export const locationStateSchema = z.object({
  place: placeSchema.nullable(),
  source: locationSourceSchema.nullable(),
  locationVersion: z.number().int().nonnegative(),
}).strict().refine((state) => (state.place === null) === (state.source === null), {
  message: 'Place and source must coexist.',
});
export type LocationState = z.infer<typeof locationStateSchema>;

export const searchQuerySchema = z.string().trim().min(2).max(100)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), 'Invalid query characters.')
  .transform((value) => value.replace(/\s+/gu, ' '));
