// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WeatherBackground } from '@/features/backgrounds/weather-background';
import userEvent from '@testing-library/user-event';
import { DemoWorkbench } from '@/features/demo/demo-workbench';

afterEach(cleanup);
it('keeps content readable while decorative images load and fall back on an error', () => {
  const { container, rerender } = render(
    <WeatherBackground presetId="rain">
      <p>Ваши образы</p>
    </WeatherBackground>,
  );
  const image = container.querySelector('img')!;
  expect(image.getAttribute('src')).toBe('/weather-backgrounds/rain.svg');
  expect(image.getAttribute('alt')).toBe('');
  expect(screen.getByText('Ваши образы')).toBeTruthy();
  fireEvent.error(image);
  expect(container.querySelector('img')!.getAttribute('src')).toBe(
    '/weather-backgrounds/default.svg',
  );
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('img')).toBeNull();
  rerender(
    <WeatherBackground presetId="snow">
      <p>Ваши образы</p>
    </WeatherBackground>,
  );
  expect(container.querySelector('img')!.getAttribute('src')).toBe('/weather-backgrounds/snow.svg');
});
it('uses neutral decoration when the result is stale or its preset is unknown', () => {
  const { container, rerender } = render(<WeatherBackground presetId="thunder" stale />);
  expect(container.querySelector('img')!.getAttribute('src')).toBe(
    '/weather-backgrounds/default.svg',
  );
  rerender(<WeatherBackground presetId="unknown" />);
  expect(container.querySelector('img')!.getAttribute('src')).toBe(
    '/weather-backgrounds/default.svg',
  );
});

it('uses the shared catalog in demo only after an explicit outfit selection', async () => {
  const user = userEvent.setup();
  const { container } = render(<DemoWorkbench />);
  const background = () =>
    container.querySelector('img[src^="/weather-backgrounds/"]')!.getAttribute('src');
  expect(background()).toBe('/weather-backgrounds/default.svg');
  await user.click(screen.getByRole('button', { name: 'Подобрать образы' }));
  expect(background()).toBe('/weather-backgrounds/clear-day.svg');
  await user.click(screen.getByRole('button', { name: /Дождливо/ }));
  expect(background()).toBe('/weather-backgrounds/default.svg');
  await user.click(screen.getByRole('button', { name: 'Подобрать образы' }));
  expect(background()).toBe('/weather-backgrounds/rain.svg');
});
