// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecognitionPanel } from '@/features/recognition/recognition-panel';
import { GarmentForm } from '@/features/wardrobe/garment-form';
import { WardrobeWorkbench } from '@/features/wardrobe/wardrobe-workbench';
import type { OperationSnapshot } from '@/server/operations/schema';

const events = vi.hoisted(() => ({ snapshot: undefined as ((snapshot: OperationSnapshot) => void) | undefined, state: 'open', ids: [] as string[] }));
vi.mock('@/features/recognition/use-operation-events', () => ({
  useOperationEvents: (ids: string[], callback: (snapshot: OperationSnapshot) => void) => {
    events.ids = ids;
    events.snapshot = callback;
    return events.state;
  },
}));
const fields = { name: 'Белая футболка', type: 't_shirt' as const, bodyAreas: ['torso' as const], seasons: ['summer' as const], layers: ['base' as const], color: 'Белый', pattern: '', warmth: 'light' as const, temperature: { min: 18, max: 28 }, rainProtection: 'unknown' as const, windProtection: 'unknown' as const };
const draft = { id: '11111111-1111-4111-8111-111111111111', photoId: '22222222-2222-4222-8222-222222222222', fields: null, garmentId: null, expiresAt: '2026-10-16T10:00:00.000Z', recognitionOperationId: null, aiProposal: null };
const operation: OperationSnapshot = { id: '33333333-3333-4333-8333-333333333333', kind: 'recognition', targetId: draft.id, status: 'queued', statusRevision: 1, sendState: 'not_sent', settlementState: 'reserved', errorCode: null, createdAt: '2026-10-15T10:00:00.000Z', deadlineAt: '2026-10-15T10:00:30.000Z' };
const budget = { month: '2026-10', limitMicroUsd: 10_000_000, confirmedCostMicroUsd: 100, activeReservedMicroUsd: 0, unknownReservedMicroUsd: 0, remainingMicroUsd: 9_999_900, warning: false };
const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data })));
function mount(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}>{element}</QueryClientProvider>), client };
}
beforeEach(() => {
  events.state = 'open';
  events.snapshot = undefined;
  events.ids = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => reply(url === '/api/ai-budget' ? budget : operation)));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('clothing recognition', () => {
  it('waits for explicit consent by button and prevents duplicate paid dispatch', async () => {
    const user = userEvent.setup();
    mount(<RecognitionPanel draft={draft} aiEnabled onApply={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText(/фотография будет отправлена в OpenAI/)).toBeTruthy();
    const button = await screen.findByRole('button', { name: 'Распознать одежду' });
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    await user.dblClick(button);
    await waitFor(() => expect(screen.getByText('Ожидаем распознавание…')).toBeTruthy());
    const calls = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`/api/garment-drafts/${draft.id}/recognition`);
    expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('restores an operation through SSE and refreshes its draft only once on terminal status', async () => {
    const complete = vi.fn();
    mount(<RecognitionPanel draft={{ ...draft, recognitionOperationId: operation.id }} aiEnabled onApply={vi.fn()} onComplete={complete} />);
    act(() => events.snapshot?.({ ...operation, status: 'running', statusRevision: 2 }));
    expect(screen.getByText('Распознаём одежду…')).toBeTruthy();
    act(() => {
      events.snapshot?.({ ...operation, status: 'succeeded', statusRevision: 3, settlementState: 'confirmed' });
      events.snapshot?.({ ...operation, status: 'succeeded', statusRevision: 3, settlementState: 'confirmed' });
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
  it('restores the admitted operation from the draft cache after leaving and returning to the page', async () => {
    const user = userEvent.setup();
    const empty = { garments: [], wardrobeVersion: 0, pendingDeletions: [] };
    vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => reply(url === '/api/ai-budget' ? budget : options?.method === 'POST' ? operation : draft)));
    const view = mount(<WardrobeWorkbench initialData={empty} initialDraftId={draft.id} aiEnabled />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Распознать одежду' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Распознать одежду' }));
    await waitFor(() => expect(view.client.getQueryData(['garment-draft', draft.id])).toMatchObject({ recognitionOperationId: operation.id }));
    view.rerender(<QueryClientProvider client={view.client}><p>Другая страница</p></QueryClientProvider>);
    view.rerender(<QueryClientProvider client={view.client}><WardrobeWorkbench initialData={empty} initialDraftId={draft.id} aiEnabled /></QueryClientProvider>);
    expect(await screen.findByText('Ожидаем распознавание…')).toBeTruthy();
    expect(events.ids).toEqual([operation.id]);
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  it('applies a proposal only when requested and keeps warnings and estimates visible', async () => {
    const user = userEvent.setup(); const apply = vi.fn();
    mount(<RecognitionPanel draft={{ ...draft, aiProposal: { kind: 'item', fields, warnings: ['Материал не определён.'] } }} aiEnabled onApply={apply} onComplete={vi.fn()} />);
    expect(screen.getByText('Материал не определён.')).toBeTruthy();
    expect(screen.getByText(/18.*28.*°C/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Применить AI-описание к форме' }));
    expect(apply).toHaveBeenCalledWith(fields);
  });
  it('keeps manual edits when a late proposal arrives, then replaces them only on explicit apply', async () => {
    const user = userEvent.setup();
    const empty = { garments: [], wardrobeVersion: 0, pendingDeletions: [] };
    vi.stubGlobal('fetch', vi.fn((url: string) => reply(url === '/api/ai-budget' ? budget : draft)));
    const { client } = mount(<WardrobeWorkbench initialData={empty} initialDraftId={draft.id} aiEnabled />);
    await user.type(await screen.findByLabelText('Название вещи'), 'Моё название');
    act(() => { client.setQueryData(['garment-draft', draft.id], { ...draft, aiProposal: { kind: 'item', fields, warnings: [] } }); });
    await screen.findByRole('button', { name: 'Применить AI-описание к форме' });
    expect(screen.getByLabelText('Название вещи')).toHaveProperty('value', 'Моё название');
    await user.click(screen.getByRole('button', { name: 'Применить AI-описание к форме' }));
    expect(screen.getByLabelText('Название вещи')).toHaveProperty('value', fields.name);
  });
  it('does not reset a manual form after its ordinary fields prop is refreshed', async () => {
    const user = userEvent.setup();
    const props = { busy: false, submitLabel: 'Сохранить', cancelLabel: 'Отмена', onSubmit: vi.fn(), onCancel: vi.fn() };
    const view = render(<GarmentForm {...props} />);
    await user.type(screen.getByLabelText('Название вещи'), 'Мои исправления');
    view.rerender(<GarmentForm {...props} fields={fields} />);
    expect(screen.getByLabelText('Название вещи')).toHaveProperty('value', 'Мои исправления');
  });
  it('explains uncertain payment and disconnected status without automatically dispatching again', async () => {
    events.state = 'reconnecting';
    mount(<RecognitionPanel draft={{ ...draft, recognitionOperationId: operation.id }} aiEnabled onApply={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText(/Восстанавливаем связь/)).toBeTruthy();
    act(() => events.snapshot?.({ ...operation, status: 'timed_out', statusRevision: 3, settlementState: 'unknown', sendState: 'sent_unknown' }));
    expect(screen.getByText(/резерв бюджета сохранён/)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
  it('allows manual description when AI is disabled and makes no AI requests', () => {
    mount(<RecognitionPanel draft={draft} aiEnabled={false} onApply={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText(/AI сейчас отключён/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('stops new recognition when the monthly budget is exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ ...budget, remainingMicroUsd: 0, warning: true })));
    mount(<RecognitionPanel draft={draft} aiEnabled onApply={vi.fn()} onComplete={vi.fn()} />);
    expect(await screen.findByText(/Бюджет AI исчерпан/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Распознать одежду' })).toHaveProperty('disabled', true);
  });
  it('keeps an existing proposal available when new AI operations are disabled', async () => {
    const user = userEvent.setup(); const apply = vi.fn();
    mount(<RecognitionPanel draft={{ ...draft, aiProposal: { kind: 'item', fields, warnings: [] } }} aiEnabled={false} onApply={apply} onComplete={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Применить AI-описание к форме' }));
    expect(apply).toHaveBeenCalledWith(fields);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['multiple_items', 'not_clothing'] as const)('explains a %s photo without offering a fabricated item', (kind) => {
    mount(<RecognitionPanel draft={{ ...draft, aiProposal: { kind, fields: null, warnings: [] } }} aiEnabled={false} onApply={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Применить AI-описание к форме' })).toBeNull();
    expect(screen.getByText(kind === 'multiple_items' ? /На фото несколько вещей/ : /На фото не удалось найти предмет одежды/)).toBeTruthy();
  });
  it('keeps the same idempotency key when the user checks a lost launch response', async () => {
    const user = userEvent.setup(); let attempts = 0;
    const network = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/ai-budget') return reply(budget);
      if (options?.method === 'POST' && ++attempts === 1) return Promise.reject(new Error('offline'));
      return reply(operation);
    });
    vi.stubGlobal('fetch', network);
    mount(<RecognitionPanel draft={draft} aiEnabled onApply={vi.fn()} onComplete={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Распознать одежду' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Распознать одежду' }));
    await screen.findByText(/Связь прервалась/);
    expect(attempts).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Проверить запуск распознавания' }));
    await screen.findByText('Ожидаем распознавание…');
    const headers = network.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => new Headers(options?.headers).get('Idempotency-Key'));
    expect(headers).toHaveLength(2);
    expect(headers[0]).toBe(headers[1]);
  });
  it('can retry a failed budget lookup without starting a paid operation', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(() => reply({ ...budget, warning: true })));
    mount(<RecognitionPanel draft={draft} aiEnabled onApply={vi.fn()} onComplete={vi.fn()} />);
    expect(await screen.findByText(/Не удалось проверить бюджет AI/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Распознать одежду' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Проверить бюджет' }));
    expect(await screen.findByText(/не менее \$8/)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
  it('starts a fresh attempt only once after a terminal operation, preserving its key if its response is lost', async () => {
    const user = userEvent.setup(); let attempts = 0;
    const nextOperation = { ...operation, id: '44444444-4444-4444-8444-444444444444' };
    const network = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/ai-budget') return reply(budget);
      if (options?.method === 'POST' && ++attempts === 1) return Promise.reject(new Error('offline'));
      return reply(nextOperation);
    });
    vi.stubGlobal('fetch', network);
    mount(<RecognitionPanel draft={{ ...draft, recognitionOperationId: operation.id }} aiEnabled onApply={vi.fn()} onComplete={vi.fn()} />);
    act(() => events.snapshot?.({ ...operation, status: 'failed', statusRevision: 2, settlementState: 'released' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Распознать заново' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Распознать заново' }));
    await screen.findByText(/Связь прервалась/);
    await user.click(screen.getByRole('button', { name: 'Проверить запуск распознавания' }));
    await screen.findByText('Ожидаем распознавание…');
    const headers = network.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => new Headers(options?.headers).get('Idempotency-Key'));
    expect(headers).toHaveLength(2);
    expect(headers[0]).toBe(headers[1]);
  });
  it.each(['interrupted', 'failed'] as const)('keeps a %s operation from automatically replaying', (status) => {
    mount(<RecognitionPanel draft={{ ...draft, recognitionOperationId: operation.id }} aiEnabled={false} onApply={vi.fn()} onComplete={vi.fn()} />);
    act(() => events.snapshot?.({ ...operation, status, statusRevision: 3, settlementState: 'released' }));
    expect(screen.getByText(status === 'interrupted' ? 'Распознавание прервалось.' : /Не удалось распознать вещь/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { body: JSON.stringify({ success: false, error: { code: 'AI_UNAVAILABLE', message: 'Распознавание временно недоступно.' } }), message: 'Распознавание временно недоступно.' },
    { body: 'not-json', message: 'Не удалось выполнить действие. Заполните описание вручную или попробуйте позже.' },
  ])('explains server rejection without automatically repeating its paid attempt: $message', async ({ body, message }) => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/ai-budget'
      ? reply(budget)
      : Promise.resolve(new Response(body, { status: 503 }))));
    mount(<RecognitionPanel draft={draft} aiEnabled onApply={vi.fn()} onComplete={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Распознать одежду' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Распознать одежду' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
});
