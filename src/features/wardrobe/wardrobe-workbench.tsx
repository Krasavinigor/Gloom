'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Garment, GarmentFields, WardrobeSnapshot } from './schema';
import { wardrobeClient, WardrobeApiError } from './client';
import { GarmentForm } from './garment-form';
import { Photo, PhotoUpload } from './photo-upload';
import { WardrobeCard } from './wardrobe-card';

const wardrobeKey = ['personal-wardrobe'] as const;
function draftUrl(id: string | null) {
  if (!/^\/wardrobe\/?$/.test(window.location.pathname)) return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('draft', id);
  else url.searchParams.delete('draft');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export function WardrobeWorkbench({
  initialData,
  initialError,
  initialDraftId,
}: {
  initialData?: WardrobeSnapshot;
  initialError?: string;
  initialDraftId?: string;
}) {
  const client = useQueryClient();
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const [editing, setEditing] = useState<Garment | null>(null);
  const [deleting, setDeleting] = useState<Garment | null>(null);
  const [editRevision, setEditRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: wardrobeKey,
    queryFn: wardrobeClient.list,
    initialData,
    staleTime: 60_000,
  });
  const draftQuery = useQuery({
    queryKey: ['garment-draft', draftId],
    queryFn: () => wardrobeClient.draft(draftId!),
    enabled: !!draftId,
    staleTime: 60_000,
  });
  function clearDraft() {
    draftUrl(null);
    setDraftId(null);
  }
  async function refresh() {
    await client.invalidateQueries({ queryKey: wardrobeKey });
  }
  const upload = useMutation({
    mutationFn: wardrobeClient.upload,
    onSuccess: (draft) => {
      client.setQueryData(['garment-draft', draft.id], draft);
      draftUrl(draft.id);
      setDraftId(draft.id);
    },
  });
  const save = useMutation({
    mutationFn: (fields: GarmentFields) => wardrobeClient.save(draftId!, fields),
    onSuccess: async () => {
      clearDraft();
      setNotice('Вещь сохранена в гардеробе.');
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => wardrobeClient.cancel(draftId!),
    onSuccess: (result) => {
      clearDraft();
      save.reset();
      upload.reset();
      setNotice(
        result.cleanupPending
          ? 'Черновик закрыт. Его файлы ожидают удаления.'
          : 'Добавление отменено.',
      );
    },
  });
  const edit = useMutation({
    mutationFn: (fields: GarmentFields) => wardrobeClient.edit(editing!, fields),
    onSuccess: async () => {
      setEditing(null);
      setNotice('Изменения сохранены.');
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => wardrobeClient.remove(deleting!),
    onSuccess: async (result) => {
      setDeleting(null);
      setNotice(
        result.cleanupPending
          ? 'Вещь удалена. Удаление файлов ещё не завершено.'
          : 'Вещь и её фотографии удалены.',
      );
      await refresh();
    },
  });
  const cleanup = useMutation({
    mutationFn: wardrobeClient.retryCleanup,
    onSuccess: async (result) => {
      setNotice(
        result.cleanupPending
          ? 'Удаление файлов ещё не завершено. Попробуйте позже.'
          : 'Файлы удалены.',
      );
      await refresh();
    },
  });
  const busy =
    upload.isPending ||
    save.isPending ||
    cancel.isPending ||
    edit.isPending ||
    remove.isPending ||
    cleanup.isPending;
  const actionError =
    upload.error ?? save.error ?? cancel.error ?? edit.error ?? remove.error ?? cleanup.error;
  async function reloadEdited() {
    if (draftId) {
      const result = await draftQuery.refetch();
      if (!result.error) save.reset();
      return;
    }
    const result = await query.refetch();
    if (!result.data || result.error) return;
    const current = result.data.garments.find((item) => item.id === (editing?.id ?? deleting?.id));
    if (deleting) {
      setDeleting(current ?? null);
      remove.reset();
      return;
    }
    setEditing(current ?? null);
    setEditRevision((version) => version + 1);
    setDeleting(null);
    edit.reset();
    remove.reset();
    if (!current) setNotice('Вещь больше не доступна в гардеробе.');
  }
  function beginEdit(garment: Garment) {
    setEditing(garment);
    setDeleting(null);
    edit.reset();
    remove.reset();
    setNotice(null);
  }
  const snapshot = query.data;
  const draft = draftQuery.data;
  return (
    <>
      <p className="mb-3 text-xs tracking-[0.2em] text-emerald-800 uppercase">
        Ваши вещи — основа каждого образа
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Мой гардероб</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-stone-500">
        Добавьте фотографию, опишите вещь и сохраните её. Описания можно изменить в любой момент.
      </p>
      {notice && (
        <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
          {notice}
        </p>
      )}
      {(query.error || (!snapshot && initialError)) && (
        <div role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">
          <p>{query.error?.message ?? initialError}</p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            Повторить загрузку гардероба
          </Button>
        </div>
      )}
      {actionError && (
        <div role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">
          <p>{actionError.message}</p>
          {actionError instanceof WardrobeApiError && actionError.status === 409 && (
            <>
              <p className="mt-2">
                Ваши несохранённые исправления остались в форме. Загрузка актуальной версии заменит
                их.
              </p>
              <Button className="mt-3" variant="outline" onClick={reloadEdited}>
                Загрузить актуальную версию
              </Button>
            </>
          )}
        </div>
      )}
      {query.isPending && (
        <p role="status" className="mt-6 text-sm text-stone-500">
          Загружаем гардероб…
        </p>
      )}
      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 text-xl font-semibold">
            {editing ? 'Редактирование вещи' : draftId ? 'Описание новой вещи' : 'Добавить вещь'}
          </h2>
          {editing ? (
            <>
              <Photo src={`/api/assets/${editing.photoId}`} alt={editing.fields.name} />
              <div className="mt-5">
                <GarmentForm
                  key={`${editing.id}:${editRevision}`}
                  fields={editing.fields}
                  busy={busy}
                  submitLabel="Сохранить изменения"
                  cancelLabel="Отменить изменения"
                  onSubmit={(fields) => edit.mutate(fields)}
                  onCancel={() => {
                    setEditing(null);
                    edit.reset();
                  }}
                />
              </div>
            </>
          ) : draftId ? (
            <>
              {draftQuery.isPending && (
                <p role="status" className="text-sm">
                  Восстанавливаем черновик…
                </p>
              )}
              {draftQuery.error && (
                <div role="alert" className="space-y-3 text-sm text-red-800">
                  <p>{draftQuery.error.message}</p>
                  <Button variant="outline" onClick={() => draftQuery.refetch()}>
                    Повторить загрузку черновика
                  </Button>
                  <Button variant="ghost" onClick={clearDraft}>
                    Закрыть черновик
                  </Button>
                </div>
              )}
              {draft &&
                (draft.garmentId ? (
                  <>
                    <p className="text-sm">Эта вещь уже сохранена в гардеробе.</p>
                    <Button
                      className="mt-4"
                      onClick={() => {
                        clearDraft();
                        refresh();
                      }}
                    >
                      Вернуться к гардеробу
                    </Button>
                  </>
                ) : (
                  <>
                    <Photo src={`/api/assets/${draft.photoId}`} alt="Фотография новой вещи" />
                    <p className="my-4 text-xs leading-5 text-stone-500">
                      Черновик хранится 24 часа. До сохранения вещь не участвует в подборе.
                    </p>
                    <GarmentForm
                      key={draft.id}
                      fields={draft.fields}
                      busy={busy}
                      submitLabel="Сохранить вещь"
                      cancelLabel="Отменить добавление"
                      onSubmit={(fields) => save.mutate(fields)}
                      onCancel={() => cancel.mutate()}
                    />
                  </>
                ))}
            </>
          ) : (
            <>
              <PhotoUpload
                busy={busy || !snapshot}
                onUpload={(file) => {
                  upload.reset();
                  save.reset();
                  setNotice(null);
                  upload.mutate(file);
                }}
              />
              <p className="mt-5 text-xs leading-5 text-stone-500">
                Распознавание одежды появится на следующем этапе. Сейчас описание заполняется
                вручную.
              </p>
            </>
          )}
        </Card>
        <section aria-label="Сохранённые вещи" className="min-w-0">
          {deleting && (
            <Card
              role="group"
              aria-label="Подтверждение удаления"
              className="mb-5 space-y-3 border-red-200 p-5"
            >
              <p>Удалить «{deleting.fields.name}» и её фотографии?</p>
              <p className="text-sm text-stone-500">Восстановить удалённую вещь нельзя.</p>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy} onClick={() => remove.mutate()}>
                  Да, удалить вещь
                </Button>
                <Button
                  autoFocus
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDeleting(null);
                    remove.reset();
                  }}
                >
                  Оставить вещь
                </Button>
              </div>
            </Card>
          )}
          {snapshot?.pendingDeletions.map((id) => (
            <Card key={id} className="mb-5 space-y-3 p-5">
              <p className="text-sm">Удалённая вещь скрыта. Её файлы ожидают удаления.</p>
              <Button variant="outline" disabled={busy} onClick={() => cleanup.mutate(id)}>
                Повторить удаление файлов
              </Button>
            </Card>
          ))}
          {snapshot?.garments.length === 0 && (
            <Card className="flex min-h-64 flex-col items-center justify-center bg-[#efeee7] p-8 text-center">
              <h2 className="text-xl font-semibold">В гардеробе пока нет вещей</h2>
              <p className="mt-3 text-sm leading-6 text-stone-500">
                Начните с одной фотографии. Сохранённая вещь появится здесь.
              </p>
            </Card>
          )}
          {!!snapshot?.garments.length && (
            <>
              <p className="mb-4 text-sm text-stone-500">Вещей: {snapshot.garments.length}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {snapshot.garments.map((garment) => (
                  <WardrobeCard
                    key={garment.id}
                    garment={garment}
                    disabled={busy || !!draftId || !!editing || !!deleting}
                    onEdit={() => beginEdit(garment)}
                    onDelete={() => {
                      setDeleting(garment);
                      setEditing(null);
                      remove.reset();
                      setNotice(null);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
