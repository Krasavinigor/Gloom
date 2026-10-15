import { z } from 'zod';

export const OPERATION_CHANNEL = 'wardrobe_ai_operations';
export const MONTH_LIMIT_MICRO_USD = 10_000_000;
export const MONTH_WARNING_MICRO_USD = 8_000_000;
export const operationStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'timed_out', 'interrupted']);
export type OperationStatus = z.infer<typeof operationStatusSchema>;
export type TerminalStatus = Exclude<OperationStatus, 'queued' | 'running'>;
export type SendState = 'not_sent' | 'sent_unknown' | 'response_received';
export type SettlementState = 'reserved' | 'confirmed' | 'unknown' | 'released';
export const admissionSchema = z.strictObject({
  kind: z.enum(['recognition', 'outfits', 'chat']),
  targetId: z.uuid(),
  idempotencyKey: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  payload: z.record(z.string(), z.unknown()),
  model: z.string().min(1).max(100),
  pricingRevision: z.string().min(1).max(100),
  reserveMicroUsd: z.number().int().positive().max(MONTH_LIMIT_MICRO_USD),
});
export type Admission = z.infer<typeof admissionSchema>;
export const operationSnapshotSchema = z.strictObject({
  id: z.uuid(), kind: admissionSchema.shape.kind, targetId: z.uuid(),
  status: operationStatusSchema, statusRevision: z.number().int().positive(),
  sendState: z.enum(['not_sent', 'sent_unknown', 'response_received']),
  settlementState: z.enum(['reserved', 'confirmed', 'unknown', 'released']),
  errorCode: z.string().nullable(), createdAt: z.iso.datetime(), deadlineAt: z.iso.datetime(),
});
export type OperationSnapshot = z.infer<typeof operationSnapshotSchema>;
export interface InternalOperation extends OperationSnapshot {
  payload: Record<string, unknown> | null;
  model: string;
  pricingRevision: string;
  admissionMonth: string;
  reserveMicroUsd: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
}
export interface BudgetSnapshot {
  month: string;
  limitMicroUsd: number;
  confirmedCostMicroUsd: number;
  activeReservedMicroUsd: number;
  unknownReservedMicroUsd: number;
  remainingMicroUsd: number;
  warning: boolean;
}
export const budgetMonth = (now = new Date()) => now.toISOString().slice(0, 7);
export const isTerminalStatus = (status: OperationStatus): status is TerminalStatus =>
  !['queued', 'running'].includes(status);
