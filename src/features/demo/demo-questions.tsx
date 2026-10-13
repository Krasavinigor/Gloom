'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function DemoQuestions({ answer }: { answer: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState<'why' | 'period' | null>(null);

  return (
    <aside className="mt-10" aria-label="Примеры вопросов и ответов">
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls="demo-questions"
        onClick={() => setOpen((value) => !value)}
      >
        Вопросы об образах <span aria-hidden="true">{open ? '−' : '+'}</span>
      </Button>
      {open && (
        <Card id="demo-questions" className="mt-4 max-w-xl p-5">
          <h2 className="font-semibold">Вопросы и ответы</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            Это готовый пример ответа. Ответы подготовлены для выбранного погодного сценария.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setQuestion('why')}>
              Почему эти вещи?
            </Button>
            <Button size="sm" variant="outline" onClick={() => setQuestion('period')}>
              На какой период образ?
            </Button>
          </div>
          {question && (
            <p
              role="status"
              className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"
            >
              {question === 'why'
                ? answer
                : 'Пример рассчитан на обычную повседневную прогулку в течение трёх часов. Погода в демо фиксированная и не является текущим прогнозом.'}
            </p>
          )}
        </Card>
      )}
    </aside>
  );
}
