import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export function Badge({ className, ...props }: ComponentProps<'span'>) { return <span data-slot="badge" className={cn('inline-flex rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600', className)} {...props} />; }
