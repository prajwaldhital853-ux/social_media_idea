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
      const target = e.target as Element | null;
      if (!target?.nodeType) return;
      if (box.current?.contains(target)) return;
      // A layer the panel itself opened — the people picker — is rendered at the
      // document root, so it sits outside the box while belonging to it. Closing
      // here would unmount the thing the click was reaching for: the box goes,
      // and the press never lands.
      if (target.closest?.('[data-stays-open]')) return;
      close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [active, box, close]);
}
