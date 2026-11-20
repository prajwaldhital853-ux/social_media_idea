'use client';

import { useEffect } from 'react';

export default function ViewportSync() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    let last = '';
    const apply = () => {
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      const kb = Math.max(0, window.innerHeight - height - top);
      const typing = !!document.activeElement?.matches('textarea, input:not([type="checkbox"]):not([type="file"]):not([type="radio"]):not([type="range"])');
      const sig = `${height}|${top}|${kb}|${typing}`;
      if (sig !== last) {
        last = sig;
        root.style.setProperty('--visible-height', `${height}px`);
        root.style.setProperty('--visible-top', `${top}px`);
        root.style.setProperty('--keyboard-bottom', `${kb}px`);
        root.dataset.typing = typing ? 'true' : 'false';
      }
      return typing;
    };
    const tick = () => {
      frame = 0;
      if (apply()) frame = requestAnimationFrame(tick);
    };
    const measure = () => { if (!frame) frame = requestAnimationFrame(tick); };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('focusout', measure);
    };
  }, []);
  return null;
}