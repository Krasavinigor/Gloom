import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { WardrobeWorkbench } from '@/features/wardrobe/wardrobe-workbench';
import type { WardrobeSnapshot } from '@/features/wardrobe/schema';
import { getWardrobeService } from '@/server/wardrobe/runtime';
import { errorResponse } from '@/server/http/errors';
import { parseServerEnvironment } from '@/server/config/environment';
export const metadata: Metadata = { title: 'Мой гардероб' };
export const dynamic = 'force-dynamic';
export default async function WardrobePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  let initialData: WardrobeSnapshot | undefined;
  let initialError: string | undefined;
  try {
    initialData = await (await getWardrobeService()).list();
  } catch (error) {
    initialError = (await errorResponse(error).json()).error.message;
  }
  const params = await searchParams;
  const initialDraftId = typeof params.draft === 'string' ? params.draft : undefined;
  return (
    <AppShell mode="personal" active="wardrobe">
      <WardrobeWorkbench
        initialData={initialData}
        initialError={initialError}
        initialDraftId={initialDraftId}
        aiEnabled={parseServerEnvironment(process.env).aiEnabled}
      />
    </AppShell>
  );
}
