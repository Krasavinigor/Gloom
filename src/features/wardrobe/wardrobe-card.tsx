'use client';
import { useI18n } from '@/i18n/provider';
import { wardrobeMessages, garmentLabel, garmentCategory } from '@/i18n/messages/wardrobe';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Garment } from './schema';
import { Photo } from './photo-upload';

export function WardrobeCard({
  garment,
  disabled,
  onEdit,
  onDelete,
}: {
  garment: Garment;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n(wardrobeMessages);
  return (
    <Card className="flex flex-col p-4">
      <Photo src={`/api/assets/${garment.photoId}`} alt={garment.fields.name} />
      <p className="mt-4 text-xs tracking-wider text-emerald-800 uppercase">
        {garmentCategory(locale, garment.fields.type)}
      </p>
      <h2 className="mt-1 text-lg font-semibold">{garment.fields.name}</h2>
      <p className="mt-1 text-sm text-stone-500">
        {garmentLabel(locale, garment.fields.type)}
        {garment.fields.color && ` · ${garment.fields.color}`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={t('editName', { name: garment.fields.name })}
          onClick={onEdit}
        >
          {t('edit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={t('deleteName', { name: garment.fields.name })}
          onClick={onDelete}
        >
          {t('delete')}
        </Button>
      </div>
    </Card>
  );
}
