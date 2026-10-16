import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { DemoWorkbench } from '@/features/demo/demo-workbench';

import { getServerLocale } from '@/i18n/server';
import { translate } from '@/i18n/core';
import { demoMessages } from '@/i18n/messages/demo';

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(await getServerLocale(), demoMessages, 'title') };
}

export default function DemoPage() {
  return (
    <AppShell mode="demo" active="outfits">
      <DemoWorkbench />
    </AppShell>
  );
}
