'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { canSeePost } from '@/lib/utils';
import { IC } from '@/lib/icons';
import AutoVideo from './AutoVideo';
import Comments from './Comments';
import ReactionButton from './ReactionButton';
import Toast from './Toast';

interface MediaPageProps {
  postId: string;
  initialIndex: number;
}

export default function MediaPage({ postId, initialIndex }: MediaPageProps) {
  const router = useRouter();
  const { db, me, isStaff, showToast, t } = useApp();
  const post = db.posts.find(p => p.id === postId);
  const available = !!post && (post.status === 'live' || me?.id === post.uid || isStaff()) && canSeePost(post, me?.id ?? null, db.follows);
  const media = (post?.media || []).filter(m => m.src || m.gen);
  const start = Math.max(0, Math.min(initialIndex, Math.max(0, media.length - 1)));
  const [index, setIndex] = useState(start);
  const [commentsIndex, setCommentsIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(start);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = start * el.clientHeight;
  }, [start, mounted]);

  useEffect(() => {
    const onResize = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = indexRef.current * el.clientHeight;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const go = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(i, media.length - 1));
    el.scrollTo({ top: next * el.clientHeight, behavior: 'smooth' });
  }, [media.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], .comments-overlay, .reaction-tray')) return;
      if (e.key === 'Escape') router.back();
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(indexRef.current + 1); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(indexRef.current - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, router]);

  if (!mounted) return <div className="media-page" />;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !el.clientHeight) return;
    const i = Math.max(0, Math.min(Math.round(el.scrollTop / el.clientHeight), media.length - 1));
    if (i !== indexRef.current) {
      indexRef.current = i;
      setIndex(i);
    }
  };

  const share = async (i: number) => {
    const url = `${window.location.origin}/post/${postId}/media/${i}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('linkCopied'));
    } catch {
      showToast(url);
    }
  };

  return (
    <div className="media-page">
      <div className="media-page-bar">
        <button type="button" className="media-page-back" aria-label="Back to post" title="Back (Esc)" onClick={() => router.back()}>
          {IC.back}
        </button>
        {available && media.length > 0 && <span className="media-page-count">{index + 1} / {media.length}</span>}
      </div>
      {available && media.length > 0 ? (
        <>
          <div className="media-page-scroll" ref={scrollRef} onScroll={onScroll}>
            {media.map((item, i) => (
              <div className="media-page-slide" key={`${item.type}-${item.src || item.gen || ''}-${i}`}>
                {item.type === 'video' ? (
                  <AutoVideo src={item.src || ''} dur={item.dur} active={i === index} seek loop />
                ) : (
                  <img src={item.src || item.gen} alt={`Photo ${i + 1} of ${media.length}`} />
                )}
                <div className="media-page-actions">
                  <ReactionButton targetType="media" targetId={`${postId}#m${i}`} />
                  <button
                    type="button"
                    className="action-btn"
                    aria-label={`Comment on ${item.type === 'video' ? 'video' : 'photo'} ${i + 1}`}
                    onClick={() => setCommentsIndex(i)}
                  >
                    {IC.msg}
                    <span>{db.comments.filter(c => c.pid === postId && c.mediaIndex === i && c.status === 'live').length || ''}</span>
                  </button>
                  <button type="button" className="action-btn" aria-label="Share this media" onClick={() => void share(i)}>
                    {IC.share}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {media.length > 1 && (
            <>
              <button type="button" className="media-page-nav up" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous media">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
              </button>
              <button type="button" className="media-page-nav down" disabled={index === media.length - 1} onClick={() => go(index + 1)} aria-label="Next media">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {media.length <= 10 && (
                <div className="media-page-dots" aria-hidden="true">
                  {media.map((_, i) => <span key={i} className={i === index ? 'on' : ''} />)}
                </div>
              )}
            </>
          )}
          {commentsIndex !== null && (
            <Comments postId={postId} mediaIndex={commentsIndex} onClose={() => setCommentsIndex(null)} />
          )}
        </>
      ) : (
        <p className="media-page-empty">This media is not available.</p>
      )}
      <Toast />
    </div>
  );
}