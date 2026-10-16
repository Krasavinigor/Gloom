'use client';

import { useState, type ReactNode } from 'react';
import { getBackgroundPreset } from './catalog';

type Props = Readonly<{
  presetId?: string | null;
  stale?: boolean;
  className?: string;
  children?: ReactNode;
}>;

function Decoration({ presetId }: { presetId: string }) {
  const [failure, setFailure] = useState<'none' | 'fallback' | 'hidden'>('none');
  const preset = getBackgroundPreset(failure === 'none' ? presetId : 'default');
  if (failure === 'hidden') return null;
  return (
    // Bundled SVG decoration needs native load errors so a missing asset cannot block content.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={preset.file}
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full object-cover"
      onError={() => setFailure(preset.id === 'default' ? 'hidden' : 'fallback')}
    />
  );
}

export function WeatherBackground({ presetId, stale = false, children, className = '' }: Props) {
  const effective = getBackgroundPreset(stale ? 'default' : presetId).id;
  return (
    <div className={`relative isolate overflow-hidden rounded-3xl bg-[#faf9f5] ${className}`}>
      <Decoration key={effective} presetId={effective} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#faf9f5]/90" />
      <div className="relative">{children}</div>
    </div>
  );
}
