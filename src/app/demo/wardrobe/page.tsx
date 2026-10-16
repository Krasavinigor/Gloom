import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { DemoWardrobe } from '@/features/demo/demo-wardrobe';
import { getServerLocale } from '@/i18n/server';
import { translate } from '@/i18n/core';
import { demoMessages } from '@/i18n/messages/demo';

export async function generateMetadata(): Promise<Metadata> {
  return { title: translate(await getServerLocale(), demoMessages, 'wardrobeTitle') };
}

export default function DemoWardrobePage() {
  return (
    <AppShell mode="demo" active="wardrobe">
      <DemoWardrobe />
    </AppShell>
  );
}
