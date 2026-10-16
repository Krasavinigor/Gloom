import { z } from 'zod';
import { LOCALE_COOKIE, localeFromRequest } from '../../i18n/core';
import { readJson } from './body';
import { errorResponse, successResponse } from './errors';
import { guardRequest } from './guard';
const selection = z.strictObject({ locale: z.enum(['en', 'ru']) });
export async function changeLocale(request: Request): Promise<Response> {
  try {
    guardRequest(request, 'mutation');
    const { locale } = selection.parse(await readJson(request));
    const response = successResponse({ locale });
    response.headers.set('Set-Cookie', `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
    return response;
  } catch (error) { return errorResponse(error, localeFromRequest(request)); }
}
