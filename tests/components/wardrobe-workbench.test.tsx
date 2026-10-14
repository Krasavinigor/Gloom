// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WardrobeWorkbench } from '@/features/wardrobe/wardrobe-workbench';
import { GarmentForm } from '@/features/wardrobe/garment-form';

const fields = { name: 'Моя футболка', type: 't_shirt' as const, bodyAreas: ['torso' as const], seasons: ['summer' as const], layers: ['base' as const], color: 'Белый', pattern: '', warmth: 'light' as const, temperature: null, rainProtection: 'unknown' as const, windProtection: 'unknown' as const };
const garment = { id: '22222222-2222-4222-8222-222222222222', photoId: '33333333-3333-4333-8333-333333333333', fields, version: 1, createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z' };
const empty = { garments: [], wardrobeVersion: 0, pendingDeletions: [] };
const draft = { id: '11111111-1111-4111-8111-111111111111', photoId: garment.photoId, fields: null, garmentId: null, expiresAt: '2026-10-15T10:00:00.000Z' };
const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } }));
function mount(props: Parameters<typeof WardrobeWorkbench>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><WardrobeWorkbench {...props} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => reply(empty)));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('personal wardrobe', () => {
  it('focuses the safe action when asking for deletion confirmation', async () => {
    const user = userEvent.setup();
    mount({ initialData: { garments: [garment], wardrobeVersion: 1, pendingDeletions: [] } });
    await user.click(screen.getByRole('button', { name: 'Удалить Моя футболка' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Оставить вещь' }));
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Да, удалить вещь' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps other card actions disabled until editing is explicitly saved or cancelled', async () => {
    const user = userEvent.setup();
    const second = { ...garment, id: '44444444-4444-4444-8444-444444444444', fields: { ...fields, name: 'Вторая вещь' } };
    mount({ initialData: { garments: [garment, second], wardrobeVersion: 2, pendingDeletions: [] } });
    await user.click(screen.getByRole('button', { name: 'Редактировать Моя футболка' }));
    await user.clear(screen.getByLabelText('Название вещи'));
    await user.type(screen.getByLabelText('Название вещи'), 'Мои исправления');
    expect(screen.getByRole('button', { name: 'Редактировать Вторая вещь' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Удалить Вторая вещь' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Отменить изменения' }));
    expect(screen.getByRole('button', { name: 'Редактировать Вторая вещь' })).toHaveProperty('disabled', false);
  });
  it('previews a selected photo before uploading, then saves a manual description', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/garment-drafts') return reply(draft);
      if (url === '/api/garments' && options?.method === 'POST') return reply(garment);
      return reply(options ? { garments: [garment], wardrobeVersion: 1, pendingDeletions: [] } : empty);
    });
    vi.stubGlobal('fetch', fetchMock); mount({ initialData: empty });
    await user.upload(screen.getByLabelText('Фотография вещи'), new File(['photo'], 'shirt.png', { type: 'image/png' }));
    expect(screen.getByAltText('Предпросмотр выбранной фотографии')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Загрузить фото' }));
    await user.type(await screen.findByLabelText('Название вещи'), 'Моя футболка');
    await user.click(screen.getByRole('checkbox', { name: 'Лето' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить вещь' }));
    await waitFor(() => expect(screen.queryByLabelText('Название вещи')).toBeNull());
    const saved = fetchMock.mock.calls.find(([url, options]) => url === '/api/garments' && options?.method === 'POST');
    expect(JSON.parse(saved![1]!.body as string).fields.name).toBe('Моя футболка');
  });
  it('rejects unsupported photos before a network upload', async () => {
    mount({ initialData: empty });
    fireEvent.change(screen.getByLabelText('Фотография вещи'), { target: { files: [new File(['heic'], 'photo.heic', { type: 'image/heic' })] } });
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('JPEG, PNG или WebP'));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves edited fields on version conflict and reloads only on request', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => options?.method === 'PATCH'
      ? Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'VERSION_CONFLICT', message: 'Вещь уже изменена. Обновите данные.' } }), { status: 409 }))
      : reply({ garments: [{ ...garment, version: 2 }], wardrobeVersion: 2, pendingDeletions: [] }));
    vi.stubGlobal('fetch', fetchMock); mount({ initialData: { garments: [garment], wardrobeVersion: 1, pendingDeletions: [] } });
    await user.click(screen.getByRole('button', { name: 'Редактировать Моя футболка' }));
    await user.clear(screen.getByLabelText('Название вещи')); await user.type(screen.getByLabelText('Название вещи'), 'Своё исправление');
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Вещь уже изменена'));
    expect((screen.getByLabelText('Название вещи') as HTMLInputElement).value).toBe('Своё исправление');
    await user.click(screen.getByRole('button', { name: 'Загрузить актуальную версию' }));
    await waitFor(() => expect((screen.getByLabelText('Название вещи') as HTMLInputElement).value).toBe('Моя футболка'));
  });
  it('asks for confirmation before deletion and lets cleanup be retried', async () => {
    const user = userEvent.setup(); let deleted = false;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'DELETE') { deleted = true; return reply({ cleanupPending: true }); }
      if (url.endsWith('/cleanup')) return reply({ cleanupPending: false });
      return reply(deleted ? { ...empty, pendingDeletions: [garment.id] } : { garments: [garment], wardrobeVersion: 1, pendingDeletions: [] });
    });
    vi.stubGlobal('fetch', fetchMock); mount({ initialData: { garments: [garment], wardrobeVersion: 1, pendingDeletions: [] } });
    await user.click(screen.getByRole('button', { name: 'Удалить Моя футболка' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Да, удалить вещь' }));
    await user.click(await screen.findByRole('button', { name: 'Повторить удаление файлов' }));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/cleanup'))).toBe(true);
  });
  it('restores an unexpired draft after refreshing its URL and cancels explicitly', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => reply(options?.method === 'DELETE' ? { cleanupPending: false } : draft));
    vi.stubGlobal('fetch', fetchMock); mount({ initialData: empty, initialDraftId: draft.id });
    expect(await screen.findByLabelText('Название вещи')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Отменить добавление' }));
    await waitFor(() => expect(screen.queryByLabelText('Название вещи')).toBeNull());
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true);
  });
  it('retains the draft and form when cancellation fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => options?.method === 'DELETE'
      ? Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'STORAGE_ERROR', message: 'Попробуйте позже.' } }), { status: 503 }))
      : reply(draft)));
    mount({ initialData: empty, initialDraftId: draft.id });
    await user.type(await screen.findByLabelText('Название вещи'), 'Несохранённая вещь');
    await user.click(screen.getByRole('button', { name: 'Отменить добавление' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Попробуйте позже.');
    expect((screen.getByLabelText('Название вещи') as HTMLInputElement).value).toBe('Несохранённая вещь');
  });
  it('explains an expired draft and lets the user return to uploading', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: false, error: { code: 'DRAFT_EXPIRED', message: 'Срок черновика истёк.' } }), { status: 410 }))));
    mount({ initialData: empty, initialDraftId: draft.id });
    expect(await screen.findByText('Срок черновика истёк.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Закрыть черновик' }));
    expect(screen.getByLabelText('Фотография вещи')).toBeTruthy();
  });
  it('shows network failure and recovers wardrobe loading on demand', async () => {
    const user = userEvent.setup(); const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(() => reply(empty));
    vi.stubGlobal('fetch', fetchMock); mount({});
    expect(await screen.findByText('Нет связи с приложением. Попробуйте ещё раз.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Повторить загрузку гардероба' }));
    expect(await screen.findByText('В гардеробе пока нет вещей')).toBeTruthy();
  });
  it('keeps a garment description visible when its photo cannot be loaded', async () => {
    mount({ initialData: { garments: [garment], wardrobeVersion: 1, pendingDeletions: [] } });
    fireEvent.error(screen.getByAltText('Моя футболка'));
    expect(screen.getByText('Фотография недоступна. Попробуйте обновить страницу.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Моя футболка' })).toBeTruthy();
  });
  it('rejects empty and oversized files before uploading', async () => {
    mount({ initialData: empty });
    const oversized = new File(['photo'], 'large.png', { type: 'image/png' }); Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('Фотография вещи'), { target: { files: [oversized] } });
    expect(await screen.findByText('Фотография должна быть не пустой и не больше 10 МБ.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Фотография вещи'), { target: { files: [new File([], 'empty.png', { type: 'image/png' })] } });
    expect(screen.queryByRole('button', { name: 'Загрузить фото' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('manual garment fields', () => {
  it('validates the name and season before submitting', async () => {
    const user = userEvent.setup(); const submit = vi.fn();
    render(<GarmentForm busy={false} submitLabel="Сохранить вещь" cancelLabel="Отмена" onSubmit={submit} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Сохранить вещь' }));
    expect(await screen.findByText('Укажите название вещи (до 120 символов).')).toBeTruthy();
    await user.type(screen.getByLabelText('Название вещи'), 'Платье');
    await user.click(screen.getByRole('button', { name: 'Сохранить вещь' }));
    expect(await screen.findByText('Выберите хотя бы один сезон.')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });
  it('updates catalog defaults, supports uncertain properties and an optional temperature range', async () => {
    const user = userEvent.setup(); const submit = vi.fn();
    render(<GarmentForm fields={fields} busy={false} submitLabel="Сохранить" cancelLabel="Отмена" onSubmit={submit} onCancel={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Тип вещи'), 'sandals');
    expect(screen.getByText('Слой для обуви и головного убора не применяется.')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Указать диапазон' }));
    await user.clear(screen.getByLabelText('От, °C')); await user.type(screen.getByLabelText('От, °C'), '15');
    await user.clear(screen.getByLabelText('До, °C')); await user.type(screen.getByLabelText('До, °C'), '30');
    await user.selectOptions(screen.getByLabelText('Защита от дождя'), 'absent');
    await user.selectOptions(screen.getByLabelText('Теплота'), 'light');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toMatchObject({ type: 'sandals', bodyAreas: ['feet'], layers: [], rainProtection: 'absent', temperature: { min: 15, max: 30 } });
  });
});
