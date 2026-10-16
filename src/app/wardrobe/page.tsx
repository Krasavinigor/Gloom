import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { WardrobeWorkbench } from '@/features/wardrobe/wardrobe-workbench';
import type { WardrobeSnapshot } from '@/features/wardrobe/schema';
import { getWardrobeService } from '@/server/wardrobe/runtime';
import { errorResponse } from '@/server/http/errors';
import { parseServerEnvironment } from '@/server/config/environment';

import { getServerLocale } from '@/i18n/server';
import { translate } from '@/i18n/core';
import { commonMessages } from '@/i18n/messages/common';
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { absolute: translate(await getServerLocale(), commonMessages, 'wardrobeTitle') },
  };
}
export const dynamic = 'force-dynamic';

export default async function WardrobePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const locale = await getServerLocale();
  let initialData: WardrobeSnapshot | undefined;
  let initialError: string | undefined;
  try {
    initialData = await (await getWardrobeService()).list();
  } catch (error) {
    initialError = (await errorResponse(error, locale).json()).error.code;
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
