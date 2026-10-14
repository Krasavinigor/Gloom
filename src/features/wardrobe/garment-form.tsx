'use client';
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
  { value: 'feet', label: 'Ступни' },
  { value: 'legs', label: 'Ноги' },
  { value: 'torso', label: 'Корпус' },
  { value: 'head', label: 'Голова' },
];
const seasonChoices = [
  { value: 'winter', label: 'Зима' },
  { value: 'midseason', label: 'Весна / осень' },
  { value: 'summer', label: 'Лето' },
];
const layerChoices = [
  { value: 'base', label: 'Базовый' },
  { value: 'middle', label: 'Средний' },
  { value: 'outer', label: 'Верхний' },
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
  const type = useWatch({ control, name: 'type' });
  const temperature = useWatch({ control, name: 'temperature' });
  const category = garmentTypeCatalog.find((item) => item.value === type)?.category;
  const withoutLayer = category === 'Обувь' || category === 'Головные уборы';
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <label className="block text-sm font-medium">
          Название вещи
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
            Тип вещи
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
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Категория
            <input
              value={category ?? ''}
              readOnly
              className={`${inputClass} bg-stone-50 text-stone-500`}
            />
          </label>
        </div>
        <Choices title="Область тела" choices={areaChoices} register={register('bodyAreas')} />
        <Choices title="Сезоны" choices={seasonChoices} register={register('seasons')} />
        {withoutLayer ? (
          <p className="text-sm text-stone-500">Слой для обуви и головного убора не применяется.</p>
        ) : (
          <Choices title="Допустимые слои" choices={layerChoices} register={register('layers')} />
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Цвет
            <input
              {...register('color')}
              maxLength={80}
              className={inputClass}
              placeholder="Неизвестно"
            />
          </label>
          <label className="block text-sm font-medium">
            Рисунок
            <input
              {...register('pattern')}
              maxLength={120}
              className={inputClass}
              placeholder="Неизвестно"
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Теплота
          <select {...register('warmth')} className={inputClass}>
            <option value="unknown">Неизвестно</option>
            <option value="light">Лёгкая</option>
            <option value="medium">Средняя</option>
            <option value="warm">Тёплая</option>
          </select>
        </label>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Ориентировочная температура</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={temperature !== null}
              onChange={(event) =>
                setValue('temperature', event.target.checked ? { min: 10, max: 25 } : null)
              }
            />
            Указать диапазон
          </label>
          {temperature !== null && (
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="text-sm">
                От, °C
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
                До, °C
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
          <p className="text-xs leading-5 text-stone-500">
            Это приблизительная оценка, а не гарантия комфорта.
          </p>
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <ProtectionChoice label="Защита от дождя" registration={register('rainProtection')} />
          <ProtectionChoice label="Защита от ветра" registration={register('windProtection')} />
        </div>
        <p className="text-xs leading-5 text-stone-500">
          Подтверждайте защиту только по свойствам вещи. По фотографии её нельзя надёжно определить.
        </p>
      </fieldset>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          {errors.name
            ? 'Укажите название вещи (до 120 символов).'
            : errors.seasons
              ? 'Выберите хотя бы один сезон.'
              : errors.bodyAreas
                ? 'Выберите хотя бы одну область тела.'
                : errors.temperature
                  ? 'Проверьте диапазон температуры: от −60 до 60 °C, нижняя граница не выше верхней.'
                  : 'Проверьте значения полей.'}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Сохраняем…' : submitLabel}
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
  return (
    <label className="block text-sm font-medium">
      {label}
      <select {...registration} className={inputClass}>
        <option value="unknown">Неизвестно</option>
        <option value="confirmed">Подтверждена</option>
        <option value="absent">Нет</option>
      </select>
    </label>
  );
}
