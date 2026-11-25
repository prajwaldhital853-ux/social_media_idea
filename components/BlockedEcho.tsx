'use client';

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

function pattern(words: string[]): RegExp | null {
  const safe = words.filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return safe.length ? new RegExp(`(${safe.join('|')})`, 'gi') : null;
}

/**
 * A transparent twin of a text field that paints only the blocked words, so a
 * refusal points at the exact letters to remove inside a long paragraph. It
 * copies the field's font, padding and scroll every render, sits over it with
 * the pointer switched off, and is only mounted once the server names words.
 */
export default function BlockedEcho({ text, words, fieldRef, fieldClass = '' }: {
  text: string;
  words: string[];
  fieldRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  fieldClass?: string;
}) {
  const echoRef = useRef<HTMLDivElement>(null);
  const re = pattern(words);
  const singleLine = fieldRef.current?.tagName === 'INPUT';

  useEffect(() => {
    const field = fieldRef.current;
    const echo = echoRef.current;
    if (!field || !echo) return;
    const sync = () => {
      const style = getComputedStyle(field);
      echo.style.font = style.font;
      echo.style.lineHeight = style.lineHeight;
      echo.style.padding = style.padding;
      echo.style.letterSpacing = style.letterSpacing;
      echo.scrollTop = field.scrollTop;
      echo.scrollLeft = field.scrollLeft;
    };
    sync();
    field.addEventListener('scroll', sync);
    field.addEventListener('input', sync);
    window.addEventListener('resize', sync);
    return () => {
      field.removeEventListener('scroll', sync);
      field.removeEventListener('input', sync);
      window.removeEventListener('resize', sync);
    };
  });

  if (!re || !text) return null;
  const parts = text.split(re);
  return (
    <div
      ref={echoRef}
      className={`${fieldClass} blocked-echo${singleLine ? ' one-line' : ''}`.trim()}
      aria-hidden="true"
    >
      {parts.map((part, i) => (i % 2 === 1
        ? <mark key={i}>{part}</mark>
        : (part && <span key={i}>{part}</span>)))}
    </div>
  );
}
