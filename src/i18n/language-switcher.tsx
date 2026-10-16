'use client';
import { useState } from 'react';
import { isLocale } from './core';
import { useI18n } from './provider';
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <label className="flex items-center gap-2">
        <span>{t('language')}</span>
        <select
          aria-label={t('language')}
          value={locale}
          disabled={busy}
          className="min-h-10 rounded-lg border border-stone-200 bg-white px-2 text-sm"
          onChange={async (event) => {
            const next = event.target.value;
            if (!isLocale(next)) return;
            setBusy(true);
            setError(false);
            try {
              await setLocale(next);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </label>
      {busy && <span role="status">{t('switching')}</span>}
      {error && (
        <span role="alert" className="text-red-800">
          {t('languageError')}
        </span>
      )}
    </div>
  );
}
