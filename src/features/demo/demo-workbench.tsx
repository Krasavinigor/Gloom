'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { demoScenarios } from './fixtures';
import { DemoHeading, DemoWeather, DemoResults } from './demo-panels';
import { DemoQuestions } from './demo-questions';

export function DemoWorkbench() {
  const [scenarioId, setScenarioId] = useState('warm');
  const [selected, setSelected] = useState(false);
  const scenario = demoScenarios.find((value) => value.id === scenarioId) ?? demoScenarios[0]!;

  return (
    <>
      <DemoHeading />

      <DemoWeather scenario={scenario} />

      <section
        aria-label="Выбор демонстрационной погоды"
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
          Подобрать образы <span aria-hidden="true">→</span>
        </Button>
      </section>
      <p className="mt-3 text-xs leading-5 text-stone-500">
        Демо работает с готовыми данными: погода не обновляется, запросы к AI не отправляются.
      </p>

      <DemoResults selected={selected} scenario={scenario} />
      {selected && <DemoQuestions key={scenario.id} answer={scenario.answer} />}
    </>
  );
}
