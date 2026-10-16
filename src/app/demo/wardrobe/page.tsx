import type { Metadata } from 'next';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { demoItems } from '@/features/demo/fixtures';
import { GarmentCard } from '@/features/demo/garment-card';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Демогардероб' };

export default function DemoWardrobePage() {
  return (
    <AppShell mode="demo" active="wardrobe">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-xs tracking-[0.2em] text-emerald-800 uppercase">
            Знакомые вещи. Новые сочетания.
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Демогардероб</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500">
            15 вещей для знакомства с проектом. Описания и свойства подготовлены заранее;
            редактирование в демо недоступно.
          </p>
        </div>
        <Button asChild>
          <Link href="/demo">Подобрать образы →</Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {demoItems.map((item) => (
          <GarmentCard item={item} key={item.id} />
        ))}
      </div>
      <p className="mt-6 text-xs leading-5 text-stone-500">
        Температуры — примерные ориентиры для отдельных вещей, а не гарантия комфорта. Все
        изображения — оригинальные иллюстрации проекта.
      </p>
    </AppShell>
  );
}
