import { garmentTypeCatalog, type Garment } from '../wardrobe/schema';
import type { WeatherSnapshot } from '../weather/schema';
import {
  outfitSuggestionSchema,
  type OutfitRole,
  type OutfitSuggestion,
  type OutfitValidation,
  type OutfitWarning,
  type ValidatedOutfit,
} from './schema';

function catalogRole(entry: (typeof garmentTypeCatalog)[number]): OutfitRole | null {
  const areas: readonly string[] = entry.bodyAreas;
  const layers: readonly string[] = entry.layers;
  if (entry.value === 'other') return null;
  if (areas.includes('feet')) return 'footwear';
  if (areas.includes('head')) return 'headwear';
  if (areas.length === 2) return 'whole';
  if (areas.includes('legs')) return 'bottom';
  if (layers.includes('middle')) return 'middle';
  if (layers.includes('outer')) return 'outer';
  return 'base_top';
}
const roleLabels: Readonly<Record<OutfitRole, string>> = {
  base_top: 'базовый верх',
  bottom: 'низ',
  whole: 'платье или комбинезон',
  middle: 'средний слой',
  outer: 'верхняя одежда',
  footwear: 'обувь',
  headwear: 'головной убор',
};
const closedFootwear = new Set(['sneakers', 'shoes', 'ankle_boots', 'boots']);

/** User-confirmed layers select possible roles; an outerwear type never replaces the base top. */
export function rolesForGarment(garment: Garment): OutfitRole[] {
  const catalog = garmentTypeCatalog.find((entry) => entry.value === garment.fields.type);
  if (!catalog) return [];
  const defaultRole = catalogRole(catalog);
  if (!defaultRole) return [];
  const coverage = garment.fields.bodyAreas;
  if (
    coverage.length !== catalog.bodyAreas.length ||
    !catalog.bodyAreas.every((area) => coverage.includes(area))
  )
    return [];
  if (defaultRole === 'footwear' || defaultRole === 'headwear')
    return garment.fields.layers.length === 0 ? [defaultRole] : [];
  if (defaultRole === 'whole' || defaultRole === 'bottom')
    return garment.fields.layers.includes('base') ? [defaultRole] : [];
  return garment.fields.layers.flatMap((layer): OutfitRole[] => {
    if (layer === 'base') return defaultRole === 'outer' ? [] : ['base_top'];
    return [layer];
  });
}

export function roleForGarment(garment: Garment): OutfitRole | null {
  const possible = rolesForGarment(garment);
  const catalog = garmentTypeCatalog.find((entry) => entry.value === garment.fields.type);
  const preferred = catalog && catalogRole(catalog);
  return preferred && possible.includes(preferred) ? preferred : (possible[0] ?? null);
}

function coldReasons(selected: ReadonlyMap<OutfitRole, Garment>, minimum: number): string[] {
  const outer = selected.get('outer');
  const footwear = selected.get('footwear');
  if (minimum >= 10) return [];
  const reasons = [
    ...(!outer ? ['Нужна верхняя одежда для прохладной погоды.'] : []),
    ...(!footwear || !closedFootwear.has(footwear.fields.type) ? ['Нужна закрытая обувь.'] : []),
  ];
  if (minimum > 0) return reasons;
  return [
    ...reasons,
    ...(!selected.has('middle') ? ['Нужен средний слой для холодной погоды.'] : []),
    ...(outer?.fields.warmth !== 'warm' ? ['Нужна тёплая верхняя одежда.'] : []),
    ...(footwear?.fields.warmth !== 'warm' ? ['Нужна тёплая закрытая обувь.'] : []),
  ];
}

function rainWarnings(
  selected: ReadonlyMap<OutfitRole, Garment>,
  weather: WeatherSnapshot,
): OutfitWarning[] {
  const summary = weather.summary;
  if (!summary || (summary.precipitationMm <= 0 && summary.precipitationProbabilityMax < 50))
    return [];
  return (['outer', 'footwear'] as const).flatMap((role) => {
    const garment = selected.get(role);
    if (garment?.fields.rainProtection === 'confirmed') return [];
    const detail =
      garment?.fields.rainProtection === 'absent'
        ? 'защита от дождя отсутствует'
        : 'защита от дождя не подтверждена';
    return [
      {
        code: 'RAIN_PROTECTION' as const,
        message: garment
          ? `${garment.fields.name}: ${detail}; образ условный для дождя.`
          : 'В образе нет верхней одежды с подтверждённой защитой от дождя; образ условный.',
        ...(garment ? { garmentId: garment.id } : {}),
      },
    ];
  });
}

function temperatureWarnings(
  selected: ReadonlyMap<OutfitRole, Garment>,
  weather: WeatherSnapshot,
): OutfitWarning[] {
  const range = weather.summary!.apparentTemperature;
  const removable: OutfitWarning[] =
    range.min >= 10 && range.min < 18 && !selected.has('middle') && !selected.has('outer')
      ? [
          {
            code: 'REMOVABLE_LAYER',
            message:
              'Рассмотрите дополнительный снимаемый слой: в течение трёх часов может быть прохладно.',
          },
        ]
      : [];
  return [
    ...removable,
    ...[...selected.values()].flatMap((garment): OutfitWarning[] => {
      const approximate = garment.fields.temperature;
      if (!approximate || (range.min >= approximate.min && range.max <= approximate.max)) return [];
      return [
        {
          code: 'TEMPERATURE_RANGE',
          garmentId: garment.id,
          message: `${garment.fields.name}: ощущаемая температура ${range.min}…${range.max} °C выходит за примерный диапазон вещи ${approximate.min}…${approximate.max} °C. Учитывайте холод и возможность снять слой при потеплении.`,
        },
      ];
    }),
  ];
}

export function validateOutfit(
  suggestion: OutfitSuggestion,
  garments: readonly Garment[],
  weather: WeatherSnapshot,
): OutfitValidation {
  const parsed = outfitSuggestionSchema.safeParse(suggestion);
  if (!parsed.success) return { valid: false, reasons: ['Некорректная структура образа.'] };
  if (!weather.summary || weather.status === 'unavailable')
    return { valid: false, reasons: ['Нет полного погодного прогноза.'] };
  const selected = new Map<OutfitRole, Garment>();
  const ids = new Set<string>();
  const reasons = parsed.data.items.flatMap((item): string[] => {
    const garment = garments.find((candidate) => candidate.id === item.garmentId);
    if (!garment) return ['Вещь отсутствует в сохранённом гардеробе.'];
    if (ids.has(item.garmentId) || selected.has(item.role))
      return ['Вещи и роли внутри образа не должны повторяться.'];
    ids.add(item.garmentId);
    if (!rolesForGarment(garment).includes(item.role))
      return ['Роль вещи не соответствует её типу, слою или покрытию тела.'];
    selected.set(item.role, garment);
    return [];
  });
  const whole = selected.has('whole');
  const baseComplete = whole
    ? !selected.has('base_top') && !selected.has('bottom')
    : selected.has('base_top') && selected.has('bottom');
  const errors = [
    ...reasons,
    ...(!baseComplete ? ['Нужен базовый верх и низ либо одна цельная вещь.'] : []),
    ...(!selected.has('footwear') ? ['Нужна обувь.'] : []),
    ...coldReasons(selected, weather.summary.apparentTemperature.min),
  ];
  if (errors.length) return { valid: false, reasons: [...new Set(errors)] };
  const warnings = [...rainWarnings(selected, weather), ...temperatureWarnings(selected, weather)];
  return {
    valid: true,
    outfit: {
      ...parsed.data,
      warnings,
      conditional: warnings.some((warning) => warning.code === 'RAIN_PROTECTION'),
    },
  };
}

export function validateOutfitSuggestions(
  suggestions: readonly OutfitSuggestion[],
  garments: readonly Garment[],
  weather: WeatherSnapshot,
): ValidatedOutfit[] {
  const valid = suggestions.flatMap((suggestion) => {
    const result = validateOutfit(suggestion, garments, weather);
    return result.valid ? [result.outfit] : [];
  });
  const composition = (value: OutfitSuggestion) =>
    value.items
      .map((item) => item.garmentId)
      .sort()
      .join('|');
  return valid.reduce<ValidatedOutfit[]>((accepted, outfit) => {
    const duplicate = accepted.some(
      (candidate) => candidate.id === outfit.id || composition(candidate) === composition(outfit),
    );
    return duplicate || accepted.length === 3 ? accepted : [...accepted, outfit];
  }, []);
}

function suitsRequiredRole(garment: Garment, role: OutfitRole, minimum: number): boolean {
  if (!rolesForGarment(garment).includes(role)) return false;
  if (role === 'footwear' && minimum < 10 && !closedFootwear.has(garment.fields.type)) return false;
  return !(
    (role === 'outer' || role === 'footwear') &&
    minimum <= 0 &&
    garment.fields.warmth !== 'warm'
  );
}

/** At most seven slots: augmenting paths prove distinct-item coverage without enumerating outfits. */
function unmatchedRoles(
  required: readonly OutfitRole[],
  garments: readonly Garment[],
  minimum: number,
): OutfitRole[] {
  const assigned = new Map<string, OutfitRole>();
  const assign = (role: OutfitRole, visited: Set<string>): boolean => {
    for (const garment of garments) {
      if (visited.has(garment.id) || !suitsRequiredRole(garment, role, minimum)) continue;
      visited.add(garment.id);
      const occupyingRole = assigned.get(garment.id);
      if (!occupyingRole || assign(occupyingRole, visited)) {
        assigned.set(garment.id, role);
        return true;
      }
    }
    return false;
  };
  return required.filter((role) => !assign(role, new Set()));
}

export function preflightWardrobe(
  garments: readonly Garment[],
  weather: WeatherSnapshot,
): { complete: boolean; missing: string[]; missingRoles?: OutfitRole[]; warm?: boolean } {
  if (!weather.summary || weather.status === 'unavailable')
    return { complete: false, missing: ['Нет полного погодного прогноза.'] };
  const minimum = weather.summary.apparentTemperature.min;
  const extra: OutfitRole[] = [
    'footwear',
    ...(minimum < 10 ? ['outer' as const] : []),
    ...(minimum <= 0 ? ['middle' as const] : []),
  ];
  const whole = unmatchedRoles(['whole', ...extra], garments, minimum);
  const separate = unmatchedRoles(['base_top', 'bottom', ...extra], garments, minimum);
  const unavailable = whole.length < separate.length ? whole : separate;
  const missing = unavailable.map(
    (role) =>
      `Не хватает: ${roleLabels[role]}${minimum <= 0 && ['outer', 'footwear'].includes(role) ? ' (тёплая)' : ''}.`,
  );
  return {
    complete: missing.length === 0,
    missing,
    ...(missing.length ? { missingRoles: unavailable, warm: minimum <= 0 } : {}),
  };
}

export function replacementAlternatives(
  outfit: OutfitSuggestion,
  targetGarmentId: string,
  garments: readonly Garment[],
  weather: WeatherSnapshot,
): Garment[] {
  const target = outfit.items.find((item) => item.garmentId === targetGarmentId);
  if (!target) return [];
  return garments.filter(
    (garment) =>
      rolesForGarment(garment).includes(target.role) &&
      !outfit.items.some((item) => item.garmentId === garment.id) &&
      validateOutfit(
        {
          id: outfit.id,
          title: outfit.title,
          explanation: outfit.explanation,
          items: outfit.items.map((item) =>
            item.garmentId === targetGarmentId ? { ...item, garmentId: garment.id } : item,
          ),
        },
        garments,
        weather,
      ).valid,
  );
}
