import { z } from 'zod';
import type { Locale } from '@/i18n/core';
import { locationStateSchema, placeSchema, type Place } from './schema';
import { weatherSnapshotSchema } from '../weather/schema';

export class LocationApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string = 'request_failed') {
    super(message);
    this.name = 'LocationApiError';
  }
}

async function request<T>(url: string, schema: z.ZodType<T>, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new LocationApiError(0, 'Could not connect to the application. Try again.', 'network_error');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new LocationApiError(response.status,
      payload?.error?.message ?? 'Could not load data. Try again.', payload?.error?.code ?? 'request_failed');
  }
  const result = schema.safeParse(payload.data);
  if (!result.success) throw new LocationApiError(502, 'Could not load data. Try again.', 'invalid_response');
  return result.data;
}

type Selection = { source: 'manual'; query: string; placeId: string; expectedVersion: number; searchLocale?: Locale }
  | { source: 'ip'; candidate: Place; expectedVersion: number };
export const locationClient = {
  get: () => request('/api/location', locationStateSchema),
  search: (query: string, locale?: Locale) => request(`/api/places?query=${encodeURIComponent(query)}${locale ? `&locale=${locale}` : ''}`, z.array(placeSchema)),
  save: (selection: Selection, signal?: AbortSignal) => request('/api/location', locationStateSchema, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection), signal,
  }),
  weather: (version: number, signal?: AbortSignal) => request(`/api/weather?locationVersion=${version}`, weatherSnapshotSchema, { signal }),
};
