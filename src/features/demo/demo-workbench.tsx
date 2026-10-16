'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDemoScenarios } from './fixtures';
import { useI18n } from '@/i18n/provider';
import { demoMessages } from '@/i18n/messages/demo';
import { DemoHeading, DemoWeather, DemoResults } from './demo-panels';
import { DemoQuestions } from './demo-questions';

export function DemoWorkbench() {
  const { locale, t } = useI18n(demoMessages);
  const demoScenarios = getDemoScenarios(locale);
  const [scenarioId, setScenarioId] = useState('warm');
  const [selected, setSelected] = useState(false);
  const scenario = demoScenarios.find((value) => value.id === scenarioId) ?? demoScenarios[0]!;

  return (
    <>
      <DemoHeading />

      <DemoWeather
        scenario={scenario}
        backgroundPresetId={
          selected
            ? ({ warm: 'clear-day', wind: 'clouds-light', rain: 'rain' }[scenario.id] ?? 'default')
            : 'default'
        }
      />

      <section
        aria-label={t('weatherChoice')}
        className="mt-6 flex flex-wrap items-center justify-between gap-5"
      >
        <div className="flex flex-wrap gap-2">
          {demoScenarios.map((value) => (
            <Button
              key={value.id}
              variant={value.id === scenarioId ? 'default' : 'outline'}
              aria-pressed={value.id === scenarioId}
              onClick={() => {
                setScenarioId(value.id);
                setSelected(false);
              }}
            >
              <span aria-hidden="true">{value.symbol}</span>
              {value.label}
            </Button>
          ))}
        </div>
        <Button onClick={() => setSelected(true)}>
          {t('choose')} <span aria-hidden="true">→</span>
        </Button>
      </section>
      <p className="mt-3 text-xs leading-5 text-stone-500">{t('readyData')}</p>

      <DemoResults selected={selected} scenario={scenario} />
      {selected && <DemoQuestions key={scenario.id} answer={scenario.answer} />}
    </>
  );
}
