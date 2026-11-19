'use client';

import { useEffect } from 'react';

export default function ViewportSync() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height || window.innerHeight;
        const top = viewport?.offsetTop || 0;
        const root = document.documentElement;
        root.style.setProperty('--visible-height', `${height}px`);
        root.style.setProperty('--visible-top', `${top}px`);
        root.style.setProperty('--keyboard-bottom', `${Math.max(0, window.innerHeight - height - top)}px`);
        root.dataset.typing = document.activeElement?.matches('textarea, input:not([type="checkbox"]):not([type="file"])') ? 'true' : 'false';
      });
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    return () => { cancelAnimationFrame(frame); viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); document.removeEventListener('focusin', measure); document.removeEventListener('focusout', measure); };
  }, []);
  return null;
}
