'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { canSeePost, compact } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { Post, User, Media } from '@/lib/types';
import { postsFragment, useList } from '@/lib/lists';
import AutoVideo from './AutoVideo';
import Comments from './Comments';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import ReactionButton from './ReactionButton';
import Toast from './Toast';
import MobileNav from './MobileNav';
import NavRail from './NavRail';
import Drawer from './Drawer';
import CreateChooser from './CreateChooser';

interface ReelSlide {
  key: string;
  post: Post;
  author: User;
  media: Media;
  mediaIndex: number;
}

export default function ReelsFeed({ initialKey }: { initialKey?: string }) {
  const router = useRouter();
  const { db, me, feature, toggleSave, isSaved, toggleFollow, isFollowing, serverMode } = useApp();
  const [index, setIndex] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  const wheelAcc = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  // The reels shelf is its own keyset stream: video-bearing posts, newest first,
  // pulled a page ahead of wherever the reader has scrolled to.
  const stream = useList(
    'reels',
    { path: '/posts/', frag: postsFragment(me?.id || null) },
    { media: 'video' },
    serverMode && feature('video'),
  );

  const byId = new Map(db.posts.map(p => [p.id, p]));
  const reels = serverMode
    ? stream.ids.map(id => byId.get(id)).filter((p): p is Post => !!p)
    : db.posts.filter(p => p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows)).sort((a, b) => b.ts - a.ts);

  const slides: ReelSlide[] = reels
    .flatMap(post => {
      const author = db.users.find(u => u.id === post.uid);
      if (!author) return [];
      return post.media
        .map((media, mediaIndex) => ({ media, mediaIndex }))
        .filter(({ media }) => media.type === 'video' && (media.src || media.gen))
        .map(({ media, mediaIndex }) => ({ key: `${post.id}-${mediaIndex}`, post, author, media, mediaIndex }));
    });

  const startIndex = Math.max(0, slides.findIndex(s => s.key === initialKey));
  const signature = slides.map(s => s.key).join('|');
  const lastSignature = useRef('');
  const viewedKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || lastSignature.current === signature) return;
    lastSignature.current = signature;
    const kept = viewedKey.current ? slides.findIndex(s => s.key === viewedKey.current) : -1;
    const target = kept >= 0 ? kept : initialKey ? startIndex : 0;
    el.scrollTop = target * el.clientHeight;
    indexRef.current = target;
    setIndex(target);
  }, [signature, startIndex, initialKey, mounted, slides]);

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
    const next = Math.max(0, Math.min(i, slides.length - 1));
    el.scrollTo({ top: next * el.clientHeight, behavior: 'smooth' });
  }, [slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], .comments-overlay, .reaction-tray')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); go(indexRef.current + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); go(indexRef.current - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.comments-overlay, .reaction-tray, .drawer')) return;
      e.preventDefault();
      wheelAcc.current += e.deltaY;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        const acc = wheelAcc.current;
        wheelAcc.current = 0;
        if (Math.abs(acc) > 32) go(indexRef.current + (acc > 0 ? 1 : -1));
      }, 90);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [go, mounted]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !el.clientHeight) return;
    const i = Math.max(0, Math.min(Math.round(el.scrollTop / el.clientHeight), slides.length - 1));
    if (i !== indexRef.current) {
      indexRef.current = i;
      viewedKey.current = slides[i]?.key ?? null;
      setIndex(i);
      setCommentsOpen(false);
    }
    // Two slides of runway: the next page is already in flight before the
    // reader reaches the end of the one on screen.
    if (serverMode && slides.length - i <= 2) void stream.loadMore();
  };

  if (!mounted) return <div className="reels-page" />;

  const current = slides[index];

  return (
    <div className="reels-page">
      <div className="reels-frame">
        <div className="reel-top">
          <button type="button" className="reel-home" aria-label="Back to home" onClick={() => router.push('/')}>
            {IC.home}
          </button>
          <span className="reel-title">Reels</span>
          {slides.length > 0 && <span className="reel-count">{index + 1} / {slides.length}</span>}
        </div>
        {feature('video') && slides.length > 0 ? (
          <div className="reels-scroll" ref={scrollRef} onScroll={onScroll}>
            {slides.map((slide, i) => {
              const commentCount = db.comments.filter(c => c.pid === slide.post.id && c.status === 'live').length;
              const saveCount = db.saves.filter(s => s.pid === slide.post.id).length;
              const saved = isSaved(slide.post.id);
              const following = isFollowing(slide.author.id);
              const own = me?.id === slide.author.id;
              const open = !!expanded[slide.key];
              return (
                <div className="reel-slide" key={slide.key}>
                  <AutoVideo src={slide.media.src || ''} dur={slide.media.dur} active={i === index} seek loop cover preload="auto" />
                  <div className="reel-rail">
                    <div className="reel-avatar">
                      <Link href={`/u/${slide.author.username}`} aria-label={slide.author.name}>
                        <Avatar user={slide.author} size={46} />
                      </Link>
                      {!own && (
                        <button
                          type="button"
                          className={`reel-follow ${following ? 'on' : ''}`}
                          aria-label={following ? `Unfollow ${slide.author.name}` : `Follow ${slide.author.name}`}
                          aria-pressed={following}
                          onClick={() => me ? toggleFollow(slide.author.id) : router.push('/login')}
                        >
                          {following ? IC.check : IC.plus}
                        </button>
                      )}
                    </div>
                    <div className="reel-rail-item">
                      <ReactionButton
                        targetType="post"
                        targetId={slide.post.id}
                        openOnClick
                        emptyLabel="Like"
                        extraCount={db.reactions.filter(r => r.targetType === 'media' && r.targetId.startsWith(`${slide.post.id}#m`)).length}
                      />
                    </div>
                    <div className="reel-rail-item">
                      <button type="button" aria-label="Comment on this reel" onClick={() => setCommentsOpen(true)}>
                        {IC.msg}
                      </button>
                      <span>{commentCount > 0 ? compact(commentCount) : 'Comment'}</span>
                    </div>
                    <div className="reel-rail-item">
                      <button
                        type="button"
                        className={`save ${saved ? 'on' : ''}`}
                        aria-label={saved ? 'Unsave this reel' : 'Save this reel'}
                        aria-pressed={saved}
                        onClick={() => me ? toggleSave(slide.post.id) : router.push('/login')}
                      >
                        {saved ? IC.bookmarkFill : IC.bookmark}
                      </button>
                      <span>{saveCount > 0 ? compact(saveCount) : 'Save'}</span>
                    </div>
                  </div>
                  <div className="reel-meta">
                    <Link href={`/u/${slide.author.username}`} className="reel-author">
                      {slide.author.name || slide.author.username}
                      {slide.author.verified && <VerifiedBadge size={14} />}
                    </Link>
                    {slide.post.text && (
                      <p className={`reel-caption ${open ? 'open' : ''}`}>{slide.post.text}</p>
                    )}
                    {slide.post.text && slide.post.text.length > 90 && (
                      <button type="button" className="reel-more" onClick={() => setExpanded(prev => ({ ...prev, [slide.key]: !open }))}>
                        {open ? 'less' : 'more'}
                      </button>
                    )}
                    {(slide.post.mood || slide.post.place) && (
                      <div className="reel-tags">
                        {slide.post.mood && <span>{slide.post.mood}</span>}
                        {slide.post.place && <span>{slide.post.place}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : serverMode && !stream.loaded && !stream.error ? (
          <div className="feed-skeleton reel-skeleton" aria-hidden="true">
            <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
            <div className="sk-block" />
          </div>
        ) : (
          <p className="reels-empty">
            {serverMode && stream.error
              ? <>{stream.error} <button type="button" className="ghost-btn" onClick={() => void stream.reload()}>Try again</button></>
              : feature('video') ? 'No reels yet. Publish a video to see it here.' : 'Video is currently unavailable.'}
          </p>
        )}
        {commentsOpen && current && <Comments postId={current.post.id} onClose={() => setCommentsOpen(false)} />}
      </div>
      <div className="reels-nav">
        <NavRail />
        <MobileNav barOnly />
        <Drawer />
      </div>
      <CreateChooser />
      <Toast />
    </div>
  );
}