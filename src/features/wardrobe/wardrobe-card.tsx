'use client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { garmentTypeCatalog, type Garment } from './schema';
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
  const type = garmentTypeCatalog.find((entry) => entry.value === garment.fields.type);
  return (
    <Card className="flex flex-col p-4">
      <Photo src={`/api/assets/${garment.photoId}`} alt={garment.fields.name} />
      <p className="mt-4 text-xs tracking-wider text-emerald-800 uppercase">{type?.category}</p>
      <h2 className="mt-1 text-lg font-semibold">{garment.fields.name}</h2>
      <p className="mt-1 text-sm text-stone-500">
        {type?.label}
        {garment.fields.color && ` · ${garment.fields.color}`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={`Редактировать ${garment.fields.name}`}
          onClick={onEdit}
        >
          Редактировать
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={`Удалить ${garment.fields.name}`}
          onClick={onDelete}
        >
          Удалить
        </Button>
      </div>
    </Card>
  );
}
