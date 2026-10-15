import type { BudgetSnapshot, OperationSnapshot } from '@/server/operations/schema';

export class RecognitionApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'RecognitionApiError';
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new RecognitionApiError('NETWORK_ERROR', 0,
      'Связь прервалась. Проверьте запуск кнопкой ниже; повторная проверка не создаст дубликат.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) {
    throw new RecognitionApiError(payload?.error?.code ?? 'REQUEST_FAILED', response.status,
      payload?.error?.message ?? 'Не удалось выполнить действие. Заполните описание вручную или попробуйте позже.');
  }
  return payload.data as T;
}

export const recognitionClient = {
  start: (draftId: string, idempotencyKey: string) => request<OperationSnapshot>(
    `/api/garment-drafts/${encodeURIComponent(draftId)}/recognition`,
    { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey } },
  ),
  budget: () => request<BudgetSnapshot>('/api/ai-budget'),
};
