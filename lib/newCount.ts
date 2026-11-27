'use client';

import { useSyncExternalStore } from 'react';

/**
 * New-post counters, one per tab kind, kept outside React on purpose: the pulse
 * frames arrive in the app context, but the badge renders in whatever chrome is
 * mounted and clears from the pages that own each tab. A refresh of the page the
 * reader just opened zeroes its counter — that is the whole vocabulary: +N while
 * you are away, gone the moment you look.
 */
export type NewKind = 'feed' | 'reels';

let counts: Record<NewKind, number> = { feed: 0, reels: 0 };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());

export function bumpNew(kind: NewKind): void {
  counts = { ...counts, [kind]: counts[kind] + 1 };
  emit();
}

export function clearNew(kind: NewKind): void {
  if (!counts[kind]) return;
  counts = { ...counts, [kind]: 0 };
  emit();
}

export function useNewCount(kind: NewKind): number {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => counts[kind],
    () => 0,
  );
}
