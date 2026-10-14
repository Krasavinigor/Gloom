import { placeSchema, type Place } from './schema';

const message = 'Не удалось определить город. Выберите его вручную.';

export async function detectIpLocation(signal?: AbortSignal): Promise<Place> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 5_000);
  try {
    if (signal?.aborted) throw new Error(message);
    const response = await fetch('https://ipapi.co/json/', {
      signal: controller.signal, credentials: 'omit', cache: 'no-store',
    });
    if (!response.ok) throw new Error(message);
    const data = await response.json();
    if (!data || data.error) throw new Error(message);
    return placeSchema.parse({
      id: 'ip', name: data.city, region: data.region ?? '', country: data.country_name,
      countryCode: data.country_code, latitude: data.latitude, longitude: data.longitude,
      timezone: data.timezone,
    });
  } catch {
    throw new Error(message);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
