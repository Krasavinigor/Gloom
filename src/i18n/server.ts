import 'server-only';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, parseLocale } from './core';
export async function getServerLocale() {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
