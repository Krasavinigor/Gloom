import { z } from 'zod';
import { WardrobeError } from '../../features/wardrobe/schema';
import { PhotoError } from '../storage/normalize-photo';
import { ApiError, privateHeaders } from './api-error';
export { ApiError, privateHeaders } from './api-error';

export function successResponse<T>(data: T, status = 200, location?: string): Response {
  return Response.json({ success: true, data }, {
    status, headers: { ...privateHeaders, ...(location ? { Location: location } : {}) },
  });
}

export function errorResponse(error: unknown): Response {
  const failure = error instanceof z.ZodError
    ? new ApiError('invalid_fields', 400, 'Проверьте поля карточки: значения не соответствуют требованиям.')
    : error;
  // Only our expected operational errors carry a public message. Never echo database/FS errors.
  const expected = (failure instanceof ApiError || failure instanceof WardrobeError || failure instanceof PhotoError)
    && failure.status >= 400 && failure.status < 600;
  if (!expected) console.error('Wardrobe request failed.', {
    kind: error instanceof Error ? error.name : 'UnknownError',
  });
  return Response.json({ success: false, error: {
    code: expected ? failure.code : 'unavailable',
    message: expected ? failure.message : 'Гардероб сейчас недоступен. Проверьте запуск базы данных и повторите попытку.',
  } }, {
    status: expected ? failure.status as number : 500,
    headers: { ...privateHeaders, ...(expected && failure.status === 429 ? { 'Retry-After': '60' } : {}) },
  });
}
