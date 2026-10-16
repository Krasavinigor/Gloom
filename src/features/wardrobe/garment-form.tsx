'use client';
import { useI18n } from '@/i18n/provider';
import { wardrobeMessages, garmentLabel, garmentCategory } from '@/i18n/messages/wardrobe';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { garmentFieldsSchema, garmentTypeCatalog, type GarmentFields } from './schema';

const inputClass =
  'mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800';
const blankFields: GarmentFields = {
  name: '',
  type: 't_shirt',
  bodyAreas: ['torso'],
  seasons: [],
  layers: ['base'],
  color: '',
  pattern: '',
  warmth: 'unknown',
  temperature: null,
  rainProtection: 'unknown',
  windProtection: 'unknown',
};
const areaChoices = [
  { value: 'feet', label: 'feet' },
  { value: 'legs', label: 'legs' },
  { value: 'torso', label: 'torso' },
  { value: 'head', label: 'head' },
];
const seasonChoices = [
  { value: 'winter', label: 'winter' },
  { value: 'midseason', label: 'midseason' },
  { value: 'summer', label: 'summer' },
];
const layerChoices = [
  { value: 'base', label: 'base' },
  { value: 'middle', label: 'middle' },
  { value: 'outer', label: 'outer' },
];

export function GarmentForm({
  fields,
  busy,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
}: {
  fields?: GarmentFields | null;
  busy: boolean;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: (fields: GarmentFields) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n(wardrobeMessages);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<z.input<typeof garmentFieldsSchema>, unknown, GarmentFields>({
    resolver: zodResolver(garmentFieldsSchema),
    defaultValues: fields ?? blankFields,
  });
  const choices = (items: typeof areaChoices) =>
    items.map((item) => ({ ...item, label: t(item.label as keyof typeof wardrobeMessages.en) }));
  const type = useWatch({ control, name: 'type' });
  const temperature = useWatch({ control, name: 'temperature' });
  const category = garmentTypeCatalog.find((item) => item.value === type)?.category;
  const withoutLayer = category === 'Обувь' || category === 'Головные уборы';
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <label className="block text-sm font-medium">
          {t('name')}
          <input
            {...register('name')}
            maxLength={120}
            autoComplete="off"
            aria-invalid={!!errors.name}
            className={inputClass}
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t('type')}
            <select
              {...register('type', {
                onChange: (event) => {
                  const entry = garmentTypeCatalog.find(
                    (item) => item.value === event.target.value,
                  )!;
                  setValue('bodyAreas', [...entry.bodyAreas]);
                  setValue('layers', [...entry.layers]);
                },
              })}
              className={inputClass}
            >
              {garmentTypeCatalog.map((item) => (
                <option key={item.value} value={item.value}>
                  {garmentLabel(locale, item.value)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t('category')}
            <input
              value={garmentCategory(locale, type)}
              readOnly
              className={`${inputClass} bg-stone-50 text-stone-500`}
            />
          </label>
        </div>
        <Choices
          title={t('bodyAreas')}
          choices={choices(areaChoices)}
          register={register('bodyAreas')}
        />
        <Choices
          title={t('seasons')}
          choices={choices(seasonChoices)}
          register={register('seasons')}
        />
        {withoutLayer ? (
          <p className="text-sm text-stone-500">{t('noLayers')}</p>
        ) : (
          <Choices
            title={t('layers')}
            choices={choices(layerChoices)}
            register={register('layers')}
          />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t('color')}
            <input
              {...register('color')}
              maxLength={80}
              className={inputClass}
              placeholder={t('unknown')}
            />
          </label>
          <label className="block text-sm font-medium">
            {t('pattern')}
            <input
              {...register('pattern')}
              maxLength={120}
              className={inputClass}
              placeholder={t('unknown')}
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          {t('warmth')}
          <select {...register('warmth')} className={inputClass}>
            <option value="unknown">{t('unknown')}</option>
            <option value="light">{t('light')}</option>
            <option value="medium">{t('medium')}</option>
            <option value="warm">{t('warm')}</option>
          </select>
        </label>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t('temperature')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={temperature !== null}
              onChange={(event) =>
                setValue('temperature', event.target.checked ? { min: 10, max: 25 } : null)
              }
            />
            {t('setRange')}
          </label>
          {temperature !== null && (
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="text-sm">
                {t('minimum')}
                <input
                  type="number"
                  step="any"
                  {...register('temperature.min', { valueAsNumber: true })}
                  className={inputClass}
                  min={-60}
                  max={60}
                />
              </label>
              <label className="text-sm">
                {t('maximum')}
                <input
                  type="number"
                  step="any"
                  {...register('temperature.max', { valueAsNumber: true })}
                  className={inputClass}
                  min={-60}
                  max={60}
                />
              </label>
            </div>
          )}
          <p className="text-xs leading-5 text-stone-500">{t('estimate')}</p>
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <ProtectionChoice label={t('rain')} registration={register('rainProtection')} />
          <ProtectionChoice label={t('wind')} registration={register('windProtection')} />
        </div>
        <p className="text-xs leading-5 text-stone-500">{t('protectionHelp')}</p>
      </fieldset>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          {errors.name
            ? t('nameError')
            : errors.seasons
              ? t('seasonsError')
              : errors.bodyAreas
                ? t('bodyError')
                : errors.temperature
                  ? t('temperatureError')
                  : t('fieldsError')}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? t('saving') : submitLabel}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  );
}

type Registration = ReturnType<ReturnType<typeof useForm>['register']>;
function Choices({
  title,
  choices,
  register,
}: {
  title: string;
  choices: { value: string; label: string }[];
  register: Registration;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{title}</legend>
      <div className="flex flex-wrap gap-3">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              value={choice.value}
              {...register}
              className="accent-emerald-800"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function ProtectionChoice({ label, registration }: { label: string; registration: Registration }) {
  const { t } = useI18n(wardrobeMessages);
  return (
    <label className="block text-sm font-medium">
      {label}
      <select {...registration} className={inputClass}>
        <option value="unknown">{t('unknown')}</option>
        <option value="confirmed">{t('confirmed')}</option>
        <option value="absent">{t('absent')}</option>
      </select>
    </label>
  );
}
