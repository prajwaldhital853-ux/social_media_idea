'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Media } from '@/lib/types';
import { IC } from '@/lib/icons';

interface MediaViewerProps {
  media: Media[];
  initialIndex: number;
  onClose: () => void;
}

export default function MediaViewer({ media, initialIndex, onClose }: MediaViewerProps) {
  const start = Math.max(0, Math.min(initialIndex, media.length - 1));
  const [index, setIndex] = useState(start);
  const [closing, setClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const indexRef = useRef(start);
  const closingRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimer.current = setTimeout(onClose, 190);
  }, [onClose]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = start * el.clientHeight;
  }, [start]);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onResize = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = indexRef.current * el.clientHeight;
    };
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === index) {
        void v.play().catch(() => {
          v.muted = true;
          void v.play().catch(() => {});
        });
      } else {
        v.pause();
      }
    });
  }, [index]);

  const go = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(i, media.length - 1));
    el.scrollTo({ top: next * el.clientHeight, behavior: 'smooth' });
  }, [media.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(indexRef.current + 1); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(indexRef.current - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, requestClose]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !el.clientHeight) return;
    const i = Math.max(0, Math.min(Math.round(el.scrollTop / el.clientHeight), media.length - 1));
    if (i !== indexRef.current) {
      indexRef.current = i;
      setIndex(i);
    }
  };

  if (!media.length) return null;

  return createPortal(
    <div className={`media-modal ${closing ? 'closing' : ''}`} onClick={e => { e.stopPropagation(); requestClose(); }} role="dialog" aria-modal="true" aria-label="Media viewer">
      <div className="media-viewer-bar" onClick={e => e.stopPropagation()}>
        <span className="media-viewer-count">{index + 1} / {media.length}</span>
        <button type="button" className="media-viewer-close" onClick={requestClose} aria-label="Close viewer" title="Close (Esc)">
          {IC.x}
        </button>
      </div>
      <div className="media-viewer-scroll" ref={scrollRef} onScroll={onScroll} onClick={e => e.stopPropagation()}>
        {media.map((item, i) => (
          <div
            className="media-slide"
            key={item.src || item.gen || i}
            onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
          >
            {item.type === 'video' ? (
              <video
                ref={el => { videos.current[i] = el; }}
                src={item.src}
                controls
                playsInline
                preload={i === index ? 'auto' : 'metadata'}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <img src={item.src || item.gen} alt={`Photo ${i + 1} of ${media.length}`} onClick={e => e.stopPropagation()} />
            )}
          </div>
        ))}
      </div>
      {media.length > 1 && (
        <>
          <button
            type="button"
            className="media-viewer-nav up"
            disabled={index === 0}
            onClick={e => { e.stopPropagation(); go(index - 1); }}
            aria-label="Previous media"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
          </button>
          <button
            type="button"
            className="media-viewer-nav down"
            disabled={index === media.length - 1}
            onClick={e => { e.stopPropagation(); go(index + 1); }}
            aria-label="Next media"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {media.length <= 10 && (
            <div className="media-viewer-dots" aria-hidden="true">
              {media.map((_, i) => <span key={i} className={i === index ? 'on' : ''} />)}
            </div>
          )}
          <span className="media-viewer-hint">Scroll or swipe for more</span>
        </>
      )}
    </div>,
    document.body
  );
}
