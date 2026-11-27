'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { useRemoteRow } from '@/lib/useRemoteRow';
import { canSeePost, privateIds } from '@/lib/utils';
import { goBack } from '@/lib/navStack';
import { IC } from '@/lib/icons';
import AutoVideo from './AutoVideo';
import Comments from './Comments';
import ReactionButton from './ReactionButton';
import ShareDialog from './ShareDialog';
import Toast from './Toast';

interface MediaPageProps {
  postId: string;
  initialIndex: number;
}

export default function MediaPage({ postId, initialIndex }: MediaPageProps) {
  const router = useRouter();
  const { db, me, t, sharePost, mayShare, showToast } = useApp();
  const post = db.posts.find(p => p.id === postId);
  // A direct link to /post/<id>/media/<n> has no list behind it; ask for the row.
  const { remote, pull } = useRemoteRow('post', postId, !!post);
  const available = !!post && post.status === 'live' && canSeePost(post, me?.id ?? null, db.follows, privateIds(db.users));
  const media = (post?.media || []).filter(m => m.src || m.gen);
  const start = Math.max(0, Math.min(initialIndex, Math.max(0, media.length - 1)));
  const [index, setIndex] = useState(start);
  const [commentsIndex, setCommentsIndex] = useState<number | null>(null);
  const [sharing, setSharing] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(start);
  const [mounted, setMounted] = useState(false);
  const wheelAcc = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = start * el.clientWidth;
    indexRef.current = start;
    setIndex(start);
  }, [start, mounted]);

  useEffect(() => {
    const onResize = () => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = indexRef.current * el.clientWidth;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const go = useCallback((i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(i, media.length - 1));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'instant' });
  }, [media.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], .comments-overlay, .reaction-tray')) return;
      if (e.key === 'Escape') goBack(router, `/post/${postId}`);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(indexRef.current + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(indexRef.current - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, router]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.comments-overlay, .reaction-tray, .drawer')) return;
      e.preventDefault();
      wheelAcc.current += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        const acc = wheelAcc.current;
        wheelAcc.current = 0;
        if (Math.abs(acc) > 32) go(indexRef.current + (acc > 0 ? 1 : -1));
      }, 40);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [go, mounted]);

  if (!mounted) return <div className="media-page" />;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.max(0, Math.min(Math.round(el.scrollLeft / el.clientWidth), media.length - 1));
    if (i !== indexRef.current) {
      indexRef.current = i;
      setIndex(i);
    }
  };

  const share = async (i: number) => {
    const refused = await mayShare(postId);
    if (refused) { showToast(refused); return; }
    setSharing(i);
  };

  return (
    <div className="media-page">
      <div className="media-page-bar">
        <button type="button" className="media-page-back" aria-label="Back to post" title="Back (Esc)" onClick={() => goBack(router, `/post/${postId}`)}>
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
                  <img src={item.src || item.gen} alt={`Photo ${i + 1} of ${media.length}`} loading={Math.abs(i - index) <= 1 ? 'eager' : 'lazy'} decoding="async" />
                )}
                <div className="media-page-actions">
                  <ReactionButton targetType="media" targetId={`${postId}#m${i}`} showMix />
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
              <button type="button" className="media-page-nav prev" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous media">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <button type="button" className="media-page-nav next" disabled={index === media.length - 1} onClick={() => go(index + 1)} aria-label="Next media">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
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
          <ShareDialog
            open={sharing !== null}
            url={`${typeof window === 'undefined' ? '' : window.location.origin}/post/${postId}/media/${sharing}`}
            title="Photo on Exposing"
            text={(post?.text || '').slice(0, 140)}
            preview={sharing !== null ? {
              title: 'Photo on Exposing',
              subtitle: (post?.text || '').slice(0, 120),
              image: media[sharing]?.type === 'image' ? (media[sharing]?.src || media[sharing]?.gen) : undefined,
              video: media[sharing]?.type === 'video' ? media[sharing]?.src : undefined,
            } : undefined}
            onShared={() => { void sharePost(postId); }}
            onClose={() => setSharing(null)}
          />
        </>
      ) : remote === 'loading' ? (
        <p className="media-page-empty">Loading…</p>
      ) : remote === 'error' ? (
        <p className="media-page-empty">
          Could not load this media. <button type="button" className="ghost-btn" onClick={pull}>{t('retry')}</button>
        </p>
      ) : (
        <p className="media-page-empty">This media is not available.</p>
      )}
      <Toast />
    </div>
  );
}