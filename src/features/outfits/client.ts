import type { OperationSnapshot } from '@/server/operations/schema';
import type { OutfitState } from '@/server/outfits/repository';
import type { Garment } from '@/features/wardrobe/schema';
import type { OutfitRole } from './schema';

export class OutfitApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'OutfitApiError';
  }
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new OutfitApiError(
      'NETWORK_ERROR',
      0,
      'Связь прервалась. Проверьте запуск кнопкой ниже; повторная проверка не создаст дубликат.',
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new OutfitApiError(
      payload?.error?.code ?? 'REQUEST_FAILED',
      response.status,
      payload?.error?.message ?? 'Не удалось выполнить действие. Попробуйте позже.',
      payload?.error?.details,
    );
  }
  return payload.data as T;
}
export const outfitClient = {
  get: () => request<OutfitState>('/api/outfit-result'),
  start: (key: string) =>
    request<OperationSnapshot>('/api/outfit-selections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: '{}',
    }),
  alternatives: (outfitId: string, slot: OutfitRole) =>
    request<{ revision: number; candidates: Garment[] }>(
      `/api/outfit-result/${encodeURIComponent(outfitId)}/alternatives?slot=${encodeURIComponent(slot)}`,
    ),
  replace: (outfitId: string, slot: OutfitRole, garmentId: string, expectedRevision: number) =>
    request<OutfitState>(
      `/api/outfit-result/${encodeURIComponent(outfitId)}/slots/${encodeURIComponent(slot)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentId, expectedRevision }),
      },
    ),
};
