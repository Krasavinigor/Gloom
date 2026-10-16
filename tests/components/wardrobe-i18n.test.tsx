// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider, useI18n } from '@/i18n/provider';
import { WardrobeWorkbench } from '@/features/wardrobe/wardrobe-workbench';
import { GarmentForm } from '@/features/wardrobe/garment-form';
function Switch() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale('ru')}>Switch</button>;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('uses English by default without translating saved user names', () => {
  render(
    <GarmentForm
      busy={false}
      submitLabel="Save"
      cancelLabel="Cancel"
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('Item name')).toBeTruthy();
  expect(screen.getByRole('option', { name: 'T-shirt' })).toBeTruthy();
});
it('keeps a dirty form when switching its interface language', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: { locale: 'ru' } }))),
  );
  render(
    <I18nProvider initialLocale="en">
      <Switch />
      <GarmentForm
        busy={false}
        submitLabel="Save"
        cancelLabel="Cancel"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByLabelText('Item name'), {
    target: { value: 'Моя собственная вещь' },
  });
  fireEvent.click(screen.getByText('Switch'));
  expect(await screen.findByLabelText('Название вещи')).toHaveProperty(
    'value',
    'Моя собственная вещь',
  );
});
it('keeps a selected photo preview across a language switch without uploading', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview');
      static revokeObjectURL = vi.fn();
    },
  );
  const request = vi.fn(
    async () => new Response(JSON.stringify({ success: true, data: { locale: 'ru' } })),
  );
  vi.stubGlobal('fetch', request);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <Switch />
        <WardrobeWorkbench
          initialData={{ garments: [], wardrobeVersion: 0, pendingDeletions: [] }}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Item photo'), {
    target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] },
  });
  expect(screen.getByAltText('Selected photo preview')).toHaveProperty('src', 'blob:preview');
  fireEvent.click(screen.getByText('Switch'));
  expect(await screen.findByAltText('Предпросмотр выбранной фотографии')).toHaveProperty(
    'src',
    'blob:preview',
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/api/locale', expect.objectContaining({ method: 'POST' }));
});
it('renders validation errors in the selected language without resubmitting the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: { locale: 'ru' } }))),
  );
  const submit = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <Switch />
      <GarmentForm
        busy={false}
        submitLabel="Save"
        cancelLabel="Cancel"
        onSubmit={submit}
        onCancel={vi.fn()}
      />
    </I18nProvider>,
  );
  fireEvent.submit(screen.getByLabelText('Item name').closest('form')!);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Enter an item name (up to 120 characters).',
  );
  fireEvent.click(screen.getByText('Switch'));
  expect(await screen.findByText('Укажите название вещи (до 120 символов).')).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
});
