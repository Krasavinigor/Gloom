import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { PersonalEmpty } from '@/components/personal-empty';
import { getPublicCapabilities } from '@/server/config/capabilities';
export const metadata: Metadata = { title: 'Мой гардероб' };
export const dynamic = 'force-dynamic';
export default function WardrobePage() { return <AppShell mode="personal" active="wardrobe"><PersonalEmpty kind="wardrobe" {...getPublicCapabilities()} /></AppShell>; }
