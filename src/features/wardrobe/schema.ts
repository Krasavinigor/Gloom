import { z } from 'zod';

export const bodyAreas = ['feet', 'legs', 'torso', 'head'] as const;
export const seasons = ['winter', 'midseason', 'summer'] as const;
export const layers = ['base', 'middle', 'outer'] as const;
export const warmthLevels = ['light', 'medium', 'warm', 'unknown'] as const;
export const protectionLevels = ['confirmed', 'absent', 'unknown'] as const;

export const garmentTypeCatalog = [
  { value: 't_shirt', label: 'Футболка', category: 'Верх', bodyAreas: ['torso'], layers: ['base'] },
  {
    value: 'long_sleeve',
    label: 'Лонгслив',
    category: 'Верх',
    bodyAreas: ['torso'],
    layers: ['base'],
  },
  { value: 'shirt', label: 'Рубашка', category: 'Верх', bodyAreas: ['torso'], layers: ['base'] },
  {
    value: 'sweater',
    label: 'Свитер',
    category: 'Средний слой',
    bodyAreas: ['torso'],
    layers: ['middle'],
  },
  {
    value: 'hoodie',
    label: 'Худи',
    category: 'Средний слой',
    bodyAreas: ['torso'],
    layers: ['middle'],
  },
  {
    value: 'cardigan',
    label: 'Кардиган',
    category: 'Средний слой',
    bodyAreas: ['torso'],
    layers: ['middle'],
  },
  {
    value: 'jacket',
    label: 'Куртка',
    category: 'Верхняя одежда',
    bodyAreas: ['torso'],
    layers: ['outer'],
  },
  {
    value: 'coat',
    label: 'Пальто',
    category: 'Верхняя одежда',
    bodyAreas: ['torso'],
    layers: ['outer'],
  },
  {
    value: 'raincoat',
    label: 'Дождевик',
    category: 'Верхняя одежда',
    bodyAreas: ['torso'],
    layers: ['outer'],
  },
  {
    value: 'vest',
    label: 'Жилет',
    category: 'Верхняя одежда',
    bodyAreas: ['torso'],
    layers: ['outer'],
  },
  { value: 'trousers', label: 'Брюки', category: 'Низ', bodyAreas: ['legs'], layers: ['base'] },
  { value: 'jeans', label: 'Джинсы', category: 'Низ', bodyAreas: ['legs'], layers: ['base'] },
  { value: 'shorts', label: 'Шорты', category: 'Низ', bodyAreas: ['legs'], layers: ['base'] },
  { value: 'skirt', label: 'Юбка', category: 'Низ', bodyAreas: ['legs'], layers: ['base'] },
  { value: 'leggings', label: 'Леггинсы', category: 'Низ', bodyAreas: ['legs'], layers: ['base'] },
  {
    value: 'dress',
    label: 'Платье',
    category: 'Цельная одежда',
    bodyAreas: ['torso', 'legs'],
    layers: ['base'],
  },
  {
    value: 'jumpsuit',
    label: 'Комбинезон',
    category: 'Цельная одежда',
    bodyAreas: ['torso', 'legs'],
    layers: ['base'],
  },
  { value: 'sneakers', label: 'Кроссовки', category: 'Обувь', bodyAreas: ['feet'], layers: [] },
  { value: 'shoes', label: 'Туфли', category: 'Обувь', bodyAreas: ['feet'], layers: [] },
  { value: 'ankle_boots', label: 'Ботинки', category: 'Обувь', bodyAreas: ['feet'], layers: [] },
  { value: 'boots', label: 'Сапоги', category: 'Обувь', bodyAreas: ['feet'], layers: [] },
  { value: 'sandals', label: 'Сандалии', category: 'Обувь', bodyAreas: ['feet'], layers: [] },
  { value: 'beanie', label: 'Шапка', category: 'Головные уборы', bodyAreas: ['head'], layers: [] },
  { value: 'cap', label: 'Кепка', category: 'Головные уборы', bodyAreas: ['head'], layers: [] },
  {
    value: 'bucket_hat',
    label: 'Панама',
    category: 'Головные уборы',
    bodyAreas: ['head'],
    layers: [],
  },
  { value: 'other', label: 'Другое', category: 'Другое', bodyAreas: ['torso'], layers: [] },
] as const;

const garmentTypes = garmentTypeCatalog.map((entry) => entry.value);
const unique = (values: readonly string[]) => new Set(values).size === values.length;

export const garmentFieldsSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    type: z.enum(garmentTypes),
    bodyAreas: z
      .array(z.enum(bodyAreas))
      .min(1)
      .max(4)
      .refine(unique, 'Области тела не должны повторяться'),
    seasons: z.array(z.enum(seasons)).min(1).max(3).refine(unique, 'Сезоны не должны повторяться'),
    layers: z.array(z.enum(layers)).max(3).refine(unique, 'Слои не должны повторяться').default([]),
    color: z.string().trim().max(80).default(''),
    pattern: z.string().trim().max(120).default(''),
    warmth: z.enum(warmthLevels).default('unknown'),
    temperature: z
      .strictObject({ min: z.number().min(-60).max(60), max: z.number().min(-60).max(60) })
      .refine((range) => range.min <= range.max, 'Нижняя температура должна быть не выше верхней')
      .nullable()
      .default(null),
    rainProtection: z.enum(protectionLevels).default('unknown'),
    windProtection: z.enum(protectionLevels).default('unknown'),
  })
  .refine(
    (fields) => {
      const category = garmentTypeCatalog.find((entry) => entry.value === fields.type)!.category;
      return !['Обувь', 'Головные уборы'].includes(category) || fields.layers.length === 0;
    },
    { path: ['layers'], message: 'Для обуви и головных уборов слой не применяется' },
  );

export type GarmentFields = z.output<typeof garmentFieldsSchema>;
export type PhotoAsset = Readonly<{
  id: string;
  key: string;
  aiKey: string;
  width: number;
  height: number;
  aiWidth: number;
  aiHeight: number;
  state: 'draft' | 'attached' | 'delete_pending';
  expiresAt: string | null;
}>;
export type Draft = Readonly<{
  id: string;
  photoId: string;
  fields: GarmentFields | null;
  expiresAt: string;
  garmentId: string | null;
}>;
export type Garment = Readonly<{
  id: string;
  photoId: string;
  fields: GarmentFields;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;
export type WardrobeSnapshot = Readonly<{
  garments: Garment[];
  wardrobeVersion: number;
  pendingDeletions: string[];
}>;

export class WardrobeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WardrobeError';
  }
}
