'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function PhotoUpload({ busy, onUpload }: { busy: boolean; onUpload: (file: File) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  function select(next?: File) {
    setError(null);
    setFile(null);
    setPreview(null);
    if (!next) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) {
      setError('Выберите фотографию JPEG, PNG или WebP.');
      return;
    }
    if (next.size > 10 * 1024 * 1024 || next.size === 0) {
      setError('Фотография должна быть не пустой и не больше 10 МБ.');
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">
        Фотография вещи
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => select(event.target.files?.[0])}
          className="mt-2 block w-full rounded-xl border border-stone-300 bg-white p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2"
        />
      </label>
      <p className="text-xs leading-5 text-stone-500">
        Одна вещь в кадре. JPEG, PNG или WebP, до 10 МБ; не больше 40 мегапикселей и 8192 px по
        стороне. Без анимации.
      </p>
      {preview && (
        <>
          <Photo src={preview} alt="Предпросмотр выбранной фотографии" />
          <Button type="button" disabled={busy} onClick={() => file && onUpload(file)}>
            {busy ? 'Загружаем…' : 'Загрузить фото'}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export function Photo({ src, alt }: { src: string; alt: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return failedSource === src ? (
    <div
      role="status"
      className="grid h-48 place-items-center rounded-xl bg-stone-100 p-4 text-sm text-stone-500"
    >
      Фотография недоступна. Попробуйте обновить страницу.
    </div>
  ) : (
    // Private assets must go through the access-checking route on every request; Next image caching would retain deleted photos.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailedSource(src)}
      className="max-h-80 w-full rounded-xl bg-stone-50 object-contain"
    />
  );
}
