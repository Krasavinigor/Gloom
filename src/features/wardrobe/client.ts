import type { Draft, Garment, GarmentFields, WardrobeSnapshot } from './schema';

export class WardrobeApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'WardrobeApiError';
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new WardrobeApiError('NETWORK_ERROR', 0, 'Нет связи с приложением. Попробуйте ещё раз.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new WardrobeApiError(payload?.error?.code ?? 'REQUEST_FAILED', response.status,
      payload?.error?.message ?? 'Не удалось выполнить действие. Попробуйте ещё раз.');
  }
  return payload.data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method, headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
export const wardrobeClient = {
  list: () => request<WardrobeSnapshot>('/api/garments'),
  upload: (file: File) => {
    const body = new FormData(); body.set('photo', file);
    return request<Draft>('/api/garment-drafts', { method: 'POST', body });
  },
  draft: (id: string) => request<Draft>(`/api/garment-drafts/${encodeURIComponent(id)}`),
  cancel: (id: string) => request<{ cleanupPending: boolean }>(`/api/garment-drafts/${encodeURIComponent(id)}`, json('DELETE')),
  save: (draftId: string, fields: GarmentFields) => request<Garment>('/api/garments', json('POST', { draftId, fields })),
  edit: (garment: Garment, fields: GarmentFields) => request<Garment>(`/api/garments/${garment.id}`, json('PATCH', { version: garment.version, fields })),
  remove: (garment: Garment) => request<{ cleanupPending: boolean }>(`/api/garments/${garment.id}`, json('DELETE', { version: garment.version })),
  retryCleanup: (id: string) => request<{ cleanupPending: boolean }>(`/api/garments/${id}/cleanup`, json('POST')),
};
