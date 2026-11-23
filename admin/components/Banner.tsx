'use client';

import { useEffect, useState } from 'react';
import { IC } from '@/lib/icons';

type Banner = { kind: 'ok' | 'bad'; text: string } | null;

/**
 * Good news leaves the screen as a small dark pill, the way the platform's own
 * toast does; bad news stays inline, because a failed save has to sit next to
 * the thing that failed until it is read.
 */
export default function Banner({ banner }: { banner: Banner }) {
  const [pill, setPill] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!banner || banner.kind !== 'ok') return;
    // The banner object is a fresh one per action, so the same sentence written
    // twice in a row still re-arms the pill instead of being swallowed.
    setPill(banner.text);
    const frame = requestAnimationFrame(() => setShow(true));
    const fade = setTimeout(() => setShow(false), 4200);
    const drop = setTimeout(() => setPill(null), 4600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fade);
      clearTimeout(drop);
    };
  }, [banner]);

  if (banner && banner.kind === 'bad') {
    return (
      <p className="banner banner-bad" role="status">{IC.alert}<span>{banner.text}</span></p>
    );
  }

  if (!pill) return null;

  return (
    <div className={`toast ${show ? 'show' : ''}`} role="status">
      <span>{pill}</span>
      <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setPill(null)}>×</button>
    </div>
  );
}
