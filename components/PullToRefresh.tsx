'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onRefresh: () => unknown;
  /** How far the drag has to travel, in css px, before releasing actually refreshes. */
  armAt?: number;
};

const MAX_PULL = 96;
// A finger moves further than the page should, and the pull has to feel heavy
// before it arms rather than firing on the first millimetre of a downward swipe.
const RESISTANCE = 0.42;

export default function PullToRefresh({ onRefresh, armAt = 62 }: Props) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const run = useRef(onRefresh);
  run.current = onRefresh;

  useEffect(() => {
    let startY: number | null = null;
    let shown = 0;
    let working = false;
    const atTop = () => window.scrollY <= 0;
    const show = (v: number) => {
      if (v === shown) return;
      shown = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      // A sheet or the drawer owns the gesture: the page behind it cannot be
      // pulled, and stealing its scroll to arm a spinner would trap the reader.
      if (working || document.querySelector('.modal-overlay, .drawer-overlay.open')) {
        startY = null;
        return;
      }
      if (!atTop()) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null || working) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || !atTop()) {
        show(0);
        return;
      }
      // Without this the gesture belongs to the browser: Chrome's own
      // pull-to-refresh reloads the whole document instead of this list.
      if (e.cancelable) e.preventDefault();
      show(Math.min(MAX_PULL, dy * RESISTANCE));
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (shown < armAt || working) {
        show(0);
        return;
      }
      working = true;
      setBusy(true);
      show(52);
      try {
        await run.current();
      } finally {
        working = false;
        setBusy(false);
        show(0);
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [armAt]);

  return (
    <div
      className={`ptr${pull > 0 ? ' visible' : ''}${busy ? ' loading' : pull > 0 ? ' dragging' : ''}`}
      style={{ transform: `translateY(${pull - 46}px)` }}
      aria-hidden={!busy}
    >
      <span className="ptr-ring">
        <span className="ptr-arc" style={busy ? undefined : { transform: `rotate(${Math.min(360, (pull / armAt) * 360)}deg)` }} />
      </span>
    </div>
  );
}
