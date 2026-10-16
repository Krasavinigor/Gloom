import { z } from 'zod';

export const outfitRoles = [
  'base_top',
  'bottom',
  'whole',
  'middle',
  'outer',
  'footwear',
  'headwear',
] as const;
export const outfitRoleSchema = z.enum(outfitRoles);
export const missingWardrobeDetailsSchema = z.strictObject({
  missingRoles: z.array(outfitRoleSchema).min(1).max(7),
  warm: z.boolean(),
});
export const outfitItemSchema = z.strictObject({
  garmentId: z.string().min(1).max(100),
  role: outfitRoleSchema,
});
export const outfitSuggestionSchema = z.strictObject({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(120),
  explanation: z.string().trim().min(1).max(1200),
  items: z.array(outfitItemSchema).min(2).max(7),
});
export const outfitSuggestionsSchema = z.strictObject({
  suggestions: z.array(outfitSuggestionSchema).min(1).max(3),
});
export type OutfitRole = z.infer<typeof outfitRoleSchema>;
export type OutfitItem = z.infer<typeof outfitItemSchema>;
export type OutfitSuggestion = z.infer<typeof outfitSuggestionSchema>;
export type OutfitWarning = Readonly<{
  code: 'RAIN_PROTECTION' | 'REMOVABLE_LAYER' | 'TEMPERATURE_RANGE';
  message: string;
  garmentId?: string;
}>;
export type ValidatedOutfit = OutfitSuggestion &
  Readonly<{ warnings: OutfitWarning[]; conditional: boolean; explanationSource?: 'replacement' }>;
export type OutfitValidation =
  | Readonly<{ valid: true; outfit: ValidatedOutfit }>
  | Readonly<{ valid: false; reasons: string[] }>;
