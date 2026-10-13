import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { getDemoItem, type DemoOutfit } from './fixtures';
export function OutfitCard({ outfit, index }: { outfit: DemoOutfit; index: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
        <span className="text-xs tracking-[0.16em] text-stone-500 uppercase">
          Образ {String(index + 1).padStart(2, '0')}
        </span>
        <span className="text-xs text-emerald-800">Готовый пример</span>
      </div>
      <div className="grid grid-cols-3 gap-1 bg-[#efeee7] px-3 py-6">
        {outfit.itemIds.map((id) => {
          const item = getDemoItem(id);
          return (
            <figure key={id} className="min-w-0">
              <Image
                src={item.image}
                width={180}
                height={180}
                alt={item.name}
                className="mx-auto h-auto w-full max-w-40"
              />
              <figcaption className="px-1 text-center text-[11px] leading-4 text-stone-600">
                {item.category}
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="space-y-3 p-5">
        <h3 className="text-xl font-semibold tracking-tight">{outfit.name}</h3>
        <p className="text-sm leading-6 text-stone-600">{outfit.explanation}</p>
        {outfit.note && (
          <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-500">
            {outfit.note}
          </p>
        )}
      </div>
    </Card>
  );
}
