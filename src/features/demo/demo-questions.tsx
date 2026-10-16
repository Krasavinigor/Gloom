'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { demoMessages } from '@/i18n/messages/demo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function DemoQuestions({ answer }: { answer: string }) {
  const { t } = useI18n(demoMessages);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState<'why' | 'period' | null>(null);

  return (
    <aside className="mt-10" aria-label={t('questionsLabel')}>
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls="demo-questions"
        onClick={() => setOpen((value) => !value)}
      >
        {t('questionsToggle')} <span aria-hidden="true">{open ? '−' : '+'}</span>
      </Button>
      {open && (
        <Card id="demo-questions" className="mt-4 max-w-xl p-5">
          <h2 className="font-semibold">{t('questionsHeading')}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">{t('preparedAnswer')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setQuestion('why')}>
              {t('why')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setQuestion('period')}>
              {t('period')}
            </Button>
          </div>
          {question && (
            <p
              role="status"
              className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"
            >
              {question === 'why' ? answer : t('periodAnswer')}
            </p>
          )}
        </Card>
      )}
    </aside>
  );
}
