// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoWorkbench } from '@/features/demo/demo-workbench';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('demo selection', () => {
  it('requires an explicit selection and clears it when weather changes', async () => {
    const user = userEvent.setup();
    render(<DemoWorkbench />);
    expect(screen.queryByRole('heading', { name: 'Лёгкий день' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Вопросы об образах' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Почему эти вещи?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Подобрать образы' }));
    expect(screen.getByRole('heading', { name: 'Лёгкий день' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Дождливо/ }));
    expect(screen.queryByRole('heading', { name: 'Лёгкий день' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Вопросы об образах' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Почему эти вещи?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Подобрать образы' }));
    expect(screen.getByRole('heading', { name: 'Под защитой' })).toBeTruthy();
  });
  it('shows ready answers without network requests or an AI claim', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup(); render(<DemoWorkbench />);
    await user.click(screen.getByRole('button', { name: 'Подобрать образы' }));
    await user.click(screen.getByRole('button', { name: 'Вопросы об образах' }));
    await user.click(screen.getByRole('button', { name: 'Почему эти вещи?' }));
    expect(screen.getByText(/Это готовый пример ответа/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
