'use client';

import { useI18n } from '@/i18n/provider';
import { demoMessages } from '@/i18n/messages/demo';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DemoItem } from './fixtures';
export function GarmentCard({ item }: { item: DemoItem }) {
  const { t } = useI18n(demoMessages);
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square bg-[#efeee7]">
        <Image
          src={item.image}
          alt={t('illustration', { name: item.name })}
          fill
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 230px"
          className="object-contain p-5"
        />
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-stone-500">
          {item.category} · {item.color}
        </p>
        <h2 className="text-sm font-semibold sm:text-base">{item.name}</h2>
        <Badge>{item.temperature}</Badge>
        <p className="text-xs text-stone-500">{item.season}</p>
      </div>
    </Card>
  );
}
