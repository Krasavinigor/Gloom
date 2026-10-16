import type { Locale } from './core';
import { errorMessages } from './messages/errors';
import { missingWardrobeDetailsSchema } from '../features/outfits/schema';
import { outfitMessages } from './messages/outfits';

export function getMissingWardrobeDetails(error: unknown) {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    error.code !== 'INCOMPLETE_WARDROBE' ||
    !('details' in error)
  )
    return null;
  const parsed = missingWardrobeDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/** Only stable public codes are rendered; SDK, SQL and filesystem messages never reach UI. */
export function getErrorMessage(locale: Locale, error: unknown): string {
  const code =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
  const messages = errorMessages[locale];
  const details = getMissingWardrobeDetails(error);
  if (details) {
    const missing = details.missingRoles
      .map((role) => {
        const label = outfitMessages[locale][`role_${role}`];
        const warm = details.warm && (role === 'outer' || role === 'footwear');
        return `${label}${warm ? (locale === 'ru' ? ' (тёплая)' : ' (warm)') : ''}`;
      })
      .join(', ');
    return locale === 'ru'
      ? `Для полного образа не хватает: ${missing}.`
      : `Missing items for a complete outfit: ${missing}.`;
  }
  return typeof code === 'string' && Object.hasOwn(messages, code)
    ? messages[code as keyof typeof messages]
    : messages.unavailable;
}
