'use client';

import { RefObject, useEffect } from 'react';

/**
 * Dismisses a top-bar panel on a click outside it. The box holds both the
 * trigger and the panel: without the trigger in the exclusion, the pointerdown
 * that closes the panel would be followed by the button's own click, which
 * opens it again. Escape is left to useBackClose, which owns the history layer.
 */
export function useDismiss(active: boolean, box: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [active, box, close]);
}
