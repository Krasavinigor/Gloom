import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { DemoWorkbench } from '@/features/demo/demo-workbench';
export const metadata: Metadata = { title: 'Демонстрация образов' };
export default function DemoPage() { return <AppShell mode="demo" active="outfits"><DemoWorkbench /></AppShell>; }
