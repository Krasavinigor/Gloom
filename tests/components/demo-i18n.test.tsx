// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoWorkbench } from '@/features/demo/demo-workbench';
import { DemoWardrobe } from '@/features/demo/demo-wardrobe';
import { I18nProvider, useI18n } from '@/i18n/provider';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => void setLocale('ru')}>Switch to Russian</button>;
}
describe('localized demo', () => {
  it('renders English by default including prepared questions and wardrobe content', async () => {
    const user = userEvent.setup();
    render(<DemoWorkbench />);
    expect(screen.getByRole('heading', { name: 'Your day starts with you.' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Find outfits' }));
    expect(screen.getByRole('heading', { name: 'A light day' })).toBeTruthy();
    expect(screen.getByAltText('Cream T-shirt')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Questions about outfits' }));
    await user.click(screen.getByRole('button', { name: 'What period is this outfit for?' }));
    expect(screen.getByRole('status').textContent).toContain('three hours');
    cleanup();
    render(<DemoWardrobe />);
    expect(screen.getByRole('heading', { name: 'Demo wardrobe' })).toBeTruthy();
    expect(screen.getByAltText('Illustration: Cream T-shirt')).toBeTruthy();
  });
  it('keeps the selected scenario, result and open question when changing language without AI calls', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: { locale: 'ru' } }), { headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<I18nProvider initialLocale="en"><SwitchLanguage /><DemoWorkbench /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: /Rainy/ }));
    await user.click(screen.getByRole('button', { name: 'Find outfits' }));
    await user.click(screen.getByRole('button', { name: 'Questions about outfits' }));
    await user.click(screen.getByRole('button', { name: 'Why these pieces?' }));
    await user.click(screen.getByRole('button', { name: 'Switch to Russian' }));
    expect(await screen.findByRole('heading', { name: 'Под защитой' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Дождливо/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('водонепроницаемость неизвестна');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/locale');
  });
});
