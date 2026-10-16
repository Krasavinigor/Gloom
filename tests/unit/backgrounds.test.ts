import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backgroundPresetIds, backgroundPresets, getBackgroundPreset, selectBackground } from '@/features/backgrounds/catalog';
import type { WeatherSnapshot } from '@/features/weather/schema';

const weather = (weatherCode: number, weatherCodes?: number[]) => ({ current: { weatherCode, isDay: true }, summary: { weatherCodes } } as unknown as WeatherSnapshot);

describe('weather background catalog', () => {
  it('bundles 8–16 original licensed illustrations with stable unique IDs', () => {
    expect(backgroundPresets.length).toBeGreaterThanOrEqual(8);
    expect(backgroundPresets.length).toBeLessThanOrEqual(16);
    expect(new Set(backgroundPresetIds).size).toBe(backgroundPresets.length);
    for (const preset of backgroundPresets) {
      expect(preset.source).toBe('Original project illustration');
      expect(preset.license).toBe('CC0-1.0');
      expect(readFileSync(`public${preset.file}`, 'utf8')).toContain('<svg');
    }
  });
  it.each([[0, 'clear-day'], [1, 'clouds-light'], [3, 'clouds-overcast'], [45, 'fog'], [48, 'fog'], [51, 'rain'], [65, 'rain'], [80, 'rain'], [56, 'snow'], [67, 'snow'], [75, 'snow'], [86, 'snow'], [95, 'thunder'], [99, 'thunder'], [1234, 'default']])('maps weather code %s to %s', (code, expected) => {
    expect(selectBackground(weather(code))).toBe(expected);
  });
  it('uses the highest priority condition in the complete forecast period', () => {
    expect(selectBackground(weather(0, [3, 45, 61, 71, 95]))).toBe('thunder');
    expect(selectBackground(weather(0, [45, 61, 71]))).toBe('snow');
    expect(selectBackground(weather(0, [45, 61]))).toBe('rain');
    expect(selectBackground(weather(0, [3, 45]))).toBe('fog');
    expect(selectBackground(weather(0, [3]))).toBe('clouds-overcast');
    expect(selectBackground(weather(0, [1234]))).toBe('default');
  });
  it('restores safe fallback for missing presets, absent weather and unavailable snapshots', () => {
    expect(getBackgroundPreset('../../private')).toBe(getBackgroundPreset('default'));
    expect(getBackgroundPreset(null).id).toBe('default');
    expect(selectBackground({ current: null } as WeatherSnapshot)).toBe('default');
    expect(selectBackground({ ...weather(95), status: 'unavailable' })).toBe('default');
    expect(selectBackground({ ...weather(0), current: { ...weather(0).current!, isDay: false } })).toBe('clear-night');
  });
});
