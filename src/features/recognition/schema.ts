import { z } from 'zod';
import { garmentFieldsSchema } from '@/features/wardrobe/schema';

const warningsSchema = z.array(z.string().trim().min(1).max(320)).max(8);

export const recognitionProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('item'), fields: garmentFieldsSchema, warnings: warningsSchema }),
  z.strictObject({ kind: z.literal('multiple_items'), fields: z.null(), warnings: warningsSchema }),
  z.strictObject({ kind: z.literal('not_clothing'), fields: z.null(), warnings: warningsSchema }),
]).transform((proposal) => proposal.kind === 'item' ? {
  ...proposal,
  fields: { ...proposal.fields, rainProtection: 'unknown' as const, windProtection: 'unknown' as const },
} : proposal);

export type RecognitionProposal = z.output<typeof recognitionProposalSchema>;
