'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { garmentTypeCatalog, type Draft, type GarmentFields } from '@/features/wardrobe/schema';
import type { OperationSnapshot } from '@/server/operations/schema';
import type { RecognitionProposal } from './schema';
import { recognitionClient } from './client';
import { useOperationEvents } from './use-operation-events';

const budgetKey = ['ai-budget'] as const;
const isActive = (operation: OperationSnapshot) => ['queued', 'running'].includes(operation.status);
const money = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(4)}`;

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
      aria-label="Распознавание одежды"
      className="mb-6 space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4"
    >
      <h3 className="font-semibold">Описание по фотографии</h3>
      {aiEnabled ? (
        <p className="text-xs leading-5 text-stone-600">
          По кнопке фотография будет отправлена в OpenAI. Проверьте предложенные свойства перед
          сохранением. Можно заполнить всё вручную.
        </p>
      ) : (
        <p className="text-sm leading-6 text-stone-500">
          AI сейчас отключён. Опишите вещь вручную — все поля доступны ниже.
        </p>
      )}
      {budget.data && (
        <p className="text-xs leading-5 text-stone-500">
          Бюджет {budget.data.month} (UTC): учтено {money(budget.data.confirmedCostMicroUsd)} из{' '}
          {money(budget.data.limitMicroUsd)}. В резерве{' '}
          {money(budget.data.activeReservedMicroUsd + budget.data.unknownReservedMicroUsd)}.
        </p>
      )}
      {budget.data?.warning && !exhausted && (
        <p role="status" className="text-sm text-amber-900">
          Использовано или зарезервировано не менее $8 месячного бюджета AI.
        </p>
      )}
      {exhausted && (
        <p role="status" className="text-sm text-amber-900">
          Бюджет AI исчерпан или зарезервирован. Ручное описание доступно.
        </p>
      )}
      {budget.error && (
        <div role="alert" className="space-y-2 text-sm text-red-800">
          <p>Не удалось проверить бюджет AI. Пока можно заполнить описание вручную.</p>
          <Button
            variant="outline"
            size="sm"
            disabled={budget.isFetching}
            onClick={() => budget.refetch()}
          >
            Проверить бюджет
          </Button>
        </div>
      )}
      {start.error && (
        <p role="alert" className="text-sm text-red-800">
          {start.error.message}
        </p>
      )}
      {active && (
        <p role="status" className="text-sm text-emerald-900">
          {operation?.status === 'running' ? 'Распознаём одежду…' : 'Ожидаем распознавание…'}
        </p>
      )}
      {active && ['connecting', 'reconnecting'].includes(connection) && (
        <p className="text-xs leading-5 text-stone-500">
          Восстанавливаем связь со статусом. Новое распознавание не запускается.
        </p>
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
            ? 'Запускаем…'
            : active
              ? 'Распознавание выполняется'
              : start.error
                ? 'Проверить запуск распознавания'
                : proposal || operation
                  ? 'Распознать заново'
                  : 'Распознать одежду'}
        </Button>
      )}
      {aiEnabled && proposal?.kind === 'item' && (
        <p className="text-xs leading-5 text-stone-500">
          Повторное распознавание — новый платный запрос. Исправление полей бесплатно.
        </p>
      )}
    </section>
  );
}

function OperationResult({ operation }: { operation: OperationSnapshot }) {
  if (operation.status === 'succeeded')
    return (
      <p role="status" className="text-sm text-emerald-900">
        Распознавание завершено. Проверьте описание.
      </p>
    );
  const message =
    operation.status === 'timed_out'
      ? 'Время ожидания истекло.'
      : operation.status === 'interrupted'
        ? 'Распознавание прервалось.'
        : 'Не удалось распознать вещь. Попробуйте другое фото или заполните описание вручную.';
  return (
    <div role="status" className="space-y-2 text-sm text-amber-900">
      <p>{message}</p>
      {operation.settlementState === 'unknown' && (
        <p>
          Результат оплаты пока неизвестен, резерв бюджета сохранён. Автоматического повтора нет;
          ручное описание доступно.
        </p>
      )}
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
  return (
    <div className="space-y-3 border-t border-emerald-200 pt-3">
      {proposal.kind === 'item' ? (
        <>
          <p className="font-medium">{proposal.fields.name}</p>
          <p className="text-sm text-stone-600">
            {garmentTypeCatalog.find((entry) => entry.value === proposal.fields.type)?.label}
            {proposal.fields.color && ` · ${proposal.fields.color}`}
            {proposal.fields.pattern && ` · ${proposal.fields.pattern}`}
          </p>
          {proposal.fields.temperature && (
            <p className="text-sm text-stone-600">
              Примерно {proposal.fields.temperature.min}…{proposal.fields.temperature.max} °C. Это
              оценка, а не гарантия комфорта.
            </p>
          )}
          <p className="text-xs leading-5 text-stone-500">
            Защита от дождя и ветра неизвестна. Подтвердите её по свойствам вещи.
          </p>
          <p className="text-xs leading-5 text-stone-500">
            Применение заменит текущие поля формы. Затем описание можно исправить перед сохранением.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={busy || applied}
            onClick={() => onApply(proposal.fields!)}
          >
            Применить AI-описание к форме
          </Button>
          {applied && (
            <p role="status" className="text-sm text-emerald-900">
              Описание перенесено в форму. Проверьте и сохраните вещь.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-amber-900">
          {proposal.kind === 'multiple_items'
            ? 'На фото несколько вещей. Загрузите каждый предмет отдельно или заполните описание вручную.'
            : 'На фото не удалось найти предмет одежды. Выберите другое фото или заполните описание вручную.'}
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
