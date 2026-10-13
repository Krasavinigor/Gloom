import type { Metadata } from 'next';
import { QueryProvider } from '@/components/query-provider';
import './globals.css';
export const metadata: Metadata = { title: { default: 'По погоде — ваш гардероб, ваш день', template: '%s · По погоде' }, description: 'Подбирайте одежду из своего гардероба под погоду. Локальный проект с демонстрационным режимом.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ru"><body><QueryProvider>{children}</QueryProvider></body></html>; }
