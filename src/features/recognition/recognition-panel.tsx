'use client';
import { useI18n } from '@/i18n/provider';
import { getErrorMessage } from '@/i18n/errors';
import { recognitionMessages } from '@/i18n/messages/recognition';
import { garmentLabel } from '@/i18n/messages/wardrobe';
import { localeTag } from '@/i18n/core';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { type Draft, type GarmentFields } from '@/features/wardrobe/schema';
import type { OperationSnapshot } from '@/server/operations/schema';
import type { RecognitionProposal } from './schema';
import { recognitionClient } from './client';
import { useOperationEvents } from './use-operation-events';

const budgetKey = ['ai-budget'] as const;
const isActive = (operation: OperationSnapshot) => ['queued', 'running'].includes(operation.status);

export function RecognitionPanel({
  draft,
  aiEnabled,
  busy = false,
  onApply,
  onComplete,
}: {
  draft: Draft;
  aiEnabled: boolean;
  busy?: boolean;
  onApply: (fields: GarmentFields) => void;
  onComplete: () => unknown;
}) {
  const { locale, t } = useI18n(recognitionMessages);
  const money = (microUsd: number) =>
    new Intl.NumberFormat(localeTag(locale), {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
    }).format(microUsd / 1_000_000);
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState<OperationSnapshot | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const dispatching = useRef(false);
  const completed = useRef(new Set<string>());
  const [applied, setApplied] = useState(false);
  const operationId = operation?.id ?? draft.recognitionOperationId ?? null;
  const budget = useQuery({
    queryKey: budgetKey,
    queryFn: recognitionClient.budget,
    enabled: aiEnabled,
    retry: false,
    staleTime: 30_000,
  });
  const start = useMutation({
    mutationFn: (key: string) => recognitionClient.start(draft.id, key),
    retry: false,
    networkMode: 'always',
    onSuccess: async (snapshot) => {
      const draftKey = ['garment-draft', draft.id];
      await queryClient.cancelQueries({ queryKey: draftKey, exact: true });
      queryClient.setQueryData<Draft>(draftKey, (current) =>
        current
          ? {
              ...current,
              recognitionOperationId: snapshot.id,
            }
          : current,
      );
      setOperation(snapshot);
      queryClient.invalidateQueries({ queryKey: budgetKey });
    },
    onSettled: () => {
      dispatching.current = false;
    },
  });
  const connection = useOperationEvents(operationId ? [operationId] : [], (snapshot) => {
    if (snapshot.id !== operationId) return;
    setOperation((current) =>
      current && current.statusRevision >= snapshot.statusRevision ? current : snapshot,
    );
    if (!isActive(snapshot) && !completed.current.has(snapshot.id)) {
      completed.current.add(snapshot.id);
      idempotencyKey.current = null;
      onComplete();
      queryClient.invalidateQueries({ queryKey: budgetKey });
    }
  });
  const active = !!operationId && (!operation || isActive(operation));
  const exhausted = !!budget.data && budget.data.remainingMicroUsd <= 0;
  function recognize() {
    if (dispatching.current || start.isPending || active || busy || !budget.data || exhausted)
      return;
    dispatching.current = true;
    if (!idempotencyKey.current) {
      idempotencyKey.current = crypto.randomUUID();
    }
    setApplied(false);
    start.mutate(idempotencyKey.current);
  }
  const proposal = active ? null : draft.aiProposal;
  return (
    <section
      aria-label={t('region')}
      className="mb-6 space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"
    >
      <h3 className="font-semibold">{t('heading')}</h3>
      {aiEnabled ? (
        <p className="text-xs leading-5 text-stone-600">{t('consent')}</p>
      ) : (
        <p className="text-sm leading-6 text-stone-500">{t('disabled')}</p>
      )}
      {budget.data && (
        <p className="text-xs leading-5 text-stone-500">
          {t('budget', {
            month: budget.data.month,
            spent: money(budget.data.confirmedCostMicroUsd),
            limit: money(budget.data.limitMicroUsd),
            reserved: money(
              budget.data.activeReservedMicroUsd + budget.data.unknownReservedMicroUsd,
            ),
          })}
        </p>
      )}
      {budget.data?.warning && !exhausted && (
        <p role="status" className="text-sm text-amber-900">
          {t('warning')}
        </p>
      )}
      {exhausted && (
        <p role="status" className="text-sm text-amber-900">
          {t('exhausted')}
        </p>
      )}
      {budget.error && (
        <div role="alert" className="space-y-2 text-sm text-red-800">
          <p>{t('budgetError')}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={budget.isFetching}
            onClick={() => budget.refetch()}
          >
            {t('checkBudget')}
          </Button>
        </div>
      )}
      {start.error && (
        <p role="alert" className="text-sm text-red-800">
          {getErrorMessage(locale, start.error)}
        </p>
      )}
      {active && (
        <p role="status" className="text-sm text-emerald-900">
          {operation?.status === 'running' ? t('running') : t('queued')}
        </p>
      )}
      {active && ['connecting', 'reconnecting'].includes(connection) && (
        <p className="text-xs leading-5 text-stone-500">{t('reconnecting')}</p>
      )}
      {operation && !isActive(operation) && <OperationResult operation={operation} />}
      {proposal && (
        <Proposal
          proposal={proposal}
          busy={busy}
          applied={applied}
          onApply={(fields) => {
            onApply(fields);
            setApplied(true);
          }}
        />
      )}
      {aiEnabled && (
        <Button
          type="button"
          variant="outline"
          disabled={
            busy || active || start.isPending || !budget.data || exhausted || !!budget.error
          }
          onClick={recognize}
        >
          {start.isPending
            ? t('starting')
            : active
              ? t('active')
              : start.error
                ? t('checkStart')
                : proposal || operation
                  ? t('again')
                  : t('recognize')}
        </Button>
      )}
      {aiEnabled && proposal?.kind === 'item' && (
        <p className="text-xs leading-5 text-stone-500">{t('paidRetry')}</p>
      )}
    </section>
  );
}

function OperationResult({ operation }: { operation: OperationSnapshot }) {
  const { t } = useI18n(recognitionMessages);
  if (operation.status === 'succeeded')
    return (
      <p role="status" className="text-sm text-emerald-900">
        {t('succeeded')}
      </p>
    );
  const message =
    operation.status === 'timed_out'
      ? t('timedOut')
      : operation.status === 'interrupted'
        ? t('interrupted')
        : t('failed');
  return (
    <div role="status" className="space-y-2 text-sm text-amber-900">
      <p>{message}</p>
      {operation.settlementState === 'unknown' && <p>{t('unknownPayment')}</p>}
    </div>
  );
}

function Proposal({
  proposal,
  busy,
  applied,
  onApply,
}: {
  proposal: RecognitionProposal;
  busy: boolean;
  applied: boolean;
  onApply: (fields: GarmentFields) => void;
}) {
  const { locale, t } = useI18n(recognitionMessages);
  return (
    <div className="space-y-3 border-t border-emerald-200 pt-3">
      {proposal.kind === 'item' ? (
        <>
          <p className="font-medium">{proposal.fields.name}</p>
          <p className="text-sm text-stone-600">
            {garmentLabel(locale, proposal.fields.type)}
            {proposal.fields.color && ` · ${proposal.fields.color}`}
            {proposal.fields.pattern && ` · ${proposal.fields.pattern}`}
          </p>
          {proposal.fields.temperature && (
            <p className="text-sm text-stone-600">
              {t('estimate', {
                min: new Intl.NumberFormat(localeTag(locale)).format(
                  proposal.fields.temperature.min,
                ),
                max: new Intl.NumberFormat(localeTag(locale)).format(
                  proposal.fields.temperature.max,
                ),
              })}
            </p>
          )}
          <p className="text-xs leading-5 text-stone-500">{t('protection')}</p>
          <p className="text-xs leading-5 text-stone-500">{t('applyHelp')}</p>
          <Button
            type="button"
            size="sm"
            disabled={busy || applied}
            onClick={() => onApply(proposal.fields!)}
          >
            {t('apply')}
          </Button>
          {applied && (
            <p role="status" className="text-sm text-emerald-900">
              {t('applied')}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-amber-900">
          {proposal.kind === 'multiple_items' ? t('multiple') : t('notFound')}
        </p>
      )}
      {!!proposal.warnings.length && (
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-stone-600">
          {proposal.warnings.map((warning, index) => (
            <li key={`${index}:${warning}`}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
