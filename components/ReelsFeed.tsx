'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { canSeePost, privateIds, compact } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { Post, User, Media } from '@/lib/types';
import { postsFragment, useList } from '@/lib/lists';
import { clearNew } from '@/lib/newCount';
import AutoVideo from './AutoVideo';
import Comments from './Comments';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import ReactionButton from './ReactionButton';
import ReportModal from './ReportModal';
import ShareDialog from './ShareDialog';
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

const RATES = [0.5, 1, 1.5, 2];

export default function ReelsFeed({ initialKey }: { initialKey?: string }) {
  const router = useRouter();
  const {
    db, me, feature, toggleSave, isSaved, toggleFollow, isFollowing, serverMode,
    sharePost, mayShare, countView, blockUser, isBlocked, t, showToast,
    activePromo, trackPromo,
  } = useApp();
  const [index, setIndex] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rate, setRate] = useState(1);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ReelSlide | null>(null);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const bufferHandlers = useRef<Record<string, (waiting: boolean) => void>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const [mounted, setMounted] = useState(false);
  const wheelAcc = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countedKey = useRef<string | null>(null);

  // A reel uploaded while the shelf is open counts on the nav icon below —
  // arriving here is what zeroes it, not a pill over the slide.
  useEffect(() => { clearNew('reels'); }, []);

  useEffect(() => setMounted(true), []);

  // The reels shelf is its own keyset stream: video-bearing posts, pulled a page
  // ahead of wherever the reader has scrolled to. It arrives in the endpoint's
  // own order — newest first — because sorting a person's reels is a question
  // about that person, and it belongs on their profile.
  //
  // It is read through the feed's own door rather than the bare post list
  // because that is where a paid placement is settled: which campaign this
  // reader is owed, how far behind the last one it sits, and what the payer is
  // charged for showing it. A reel shelf that skipped that door would show
  // adverts nobody placed and charge for none of them.
  const stream = useList(
    'reels',
    { path: '/feed/', frag: postsFragment(me?.id || null) },
    { media: 'video' },
    serverMode && feature('video'),
  );

  // The reels page re-reads page one when the reader returns, so a reel posted
  // while they were away takes the top. A cold load is already a first read,
  // so only a return visit re-pulls here.
  const restream = useRef(stream.reload);
  restream.current = stream.reload;
  const returned = useRef(false);
  useEffect(() => {
    if (!serverMode) return;
    if (returned.current) restream.current();
    returned.current = true;
  }, []);

  // A phone's back button restores this page from the browser's own snapshot
  // without remounting anything, so the re-pull rides on pageshow instead.
  useEffect(() => {
    if (!serverMode) return;
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) restream.current();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [serverMode]);

  const byId = new Map(db.posts.map(p => [p.id, p]));
  const reels = serverMode
    ? stream.ids.map(id => byId.get(id)).filter((p): p is Post => !!p && p.status === 'live')
    : db.posts
        .filter(p => p.status === 'live' && (p.media || []).some(m => m.type === 'video')
          && canSeePost(p, me?.id ?? null, db.follows, privateIds(db.users))
          && !isBlocked(p.uid))
        .sort((a, b) => b.ts - a.ts);

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

  // The reel on screen is the reel being watched, so it is counted once — and
  // not at all while the decoder is still catching up on it.
  useEffect(() => {
    const slide = slides[index];
    if (!slide || buffering) return;
    if (countedKey.current === slide.key) return;
    countedKey.current = slide.key;
    void countView(slide.post.id);
  }, [index, slides, buffering, countView]);

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

  // A menu raised by a hold closes on the next tap anywhere else, the way the
  // reaction tray does; the other way out is holding the video again.
  useEffect(() => {
    if (!menuFor) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.reel-menu')) setMenuFor(null);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menuFor]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.comments-overlay, .reaction-tray, .drawer, .reel-menu')) return;
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
    if (!el || !el.clientHeight) return;    const i = Math.max(0, Math.min(Math.round(el.scrollTop / el.clientHeight), slides.length - 1));
    if (i !== indexRef.current) {
      indexRef.current = i;
      viewedKey.current = slides[i]?.key ?? null;
      setIndex(i);
      setCommentsOpen(false);
      setMenuFor(null);
    }
    // Two slides of runway: the next page is already in flight before the
    // reader reaches the end of the one on screen.
    if (serverMode && slides.length - i <= 2) void stream.loadMore();
  };

  if (!mounted) return <div className="reels-page" />;

  const current = slides[index];

  // Which slides have enough decoded to show something. A shelf of twelve reels
  // loads them all, so this is per slide rather than one flag for the page.
  const onBufferFor = (key: string) => {
    if (!bufferHandlers.current[key]) {
      bufferHandlers.current[key] = (waiting: boolean) =>
        setReady(prev => (prev[key] === !waiting ? prev : { ...prev, [key]: !waiting }));
    }
    return bufferHandlers.current[key];
  };

  // The menu hands out the same sheet the rail does: a reel is shared to people
  // and apps, not just pasted as a link on the clipboard. The desk's ceiling is
  // asked first, so a share past it stops at the button.
  const shareReel = async (slide: ReelSlide) => {
    const refused = await mayShare(slide.post.id);
    if (refused) { showToast(refused); return; }
    setSharing(slide);
  };

  return (
    <div className="reels-page">
      <div className="reels-frame">
        <div className="reel-top">
          <button type="button" className="reel-home" aria-label="Back to home" onClick={() => router.push('/')}>
            {IC.home}
          </button>
          <span className="reel-title">Reels</span>
        </div>
        {feature('video') && slides.length > 0 ? (
          <div className="reels-scroll" ref={scrollRef} onScroll={onScroll}>
            {slides.map((slide, i) => {
              const commentCount = slide.post.comments ?? db.comments.filter(c => c.pid === slide.post.id && c.status === 'live').length;
              const shareCount = slide.post.shares ?? 0;
              const saveCount = db.saves.filter(s => s.pid === slide.post.id).length;
              const saved = isSaved(slide.post.id);
              const following = isFollowing(slide.author.id);
              const own = me?.id === slide.author.id;
              const open = !!expanded[slide.key];
              // The disclosure rides the row the server wrote, not only the campaign
              // this cache happens to hold: a paid clip whose paperwork has not
              // arrived yet is still something somebody bought.
              const promo = activePromo('post', slide.post.id);
              const paid = (!!promo || slide.post.promoted) && !own;
              const askReel = () => {
                if (promo && !own) void trackPromo(promo.id, 'click');
                const seed = slide.post.text?.trim()
                  ? t('promoAsk', { text: slide.post.text.trim().slice(0, 80) })
                  : t('promoAskBare');
                router.push(me ? `/messages/${slide.author.username}?text=${encodeURIComponent(seed)}` : '/login');
              };
              return (
                <div className="reel-slide" key={slide.key}>
                  <AutoVideo
                    src={slide.media.src || ''}
                    dur={slide.media.dur}
                    active={i === index}
                    seek
                    loop
                    cover
                    preload="auto"
                    rate={rate}
                    onLongPress={() => setMenuFor(menuFor === slide.key ? null : slide.key)}
                    onBuffering={onBufferFor(slide.key)}
                  />
                  {!ready[slide.key] && (
                    <div className="reel-loading" role="status" aria-label="Loading this reel">
                      <div className="reel-loading-shape" /><div className="reel-loading-shape" /><div className="reel-loading-shape" />
                      <span className="reel-loading-ring" aria-hidden="true" />
                    </div>
                  )}
                  {menuFor === slide.key && (
                    <div className="reel-menu" role="dialog" aria-label={t('reelOptions')} onClick={e => e.stopPropagation()}>
                      <button type="button" className="reel-menu-item" onClick={() => { setMenuFor(null); void shareReel(slide); }}>
                        {t('share')}
                      </button>
                      <div className="reel-menu-row">
                        <span className="reel-menu-label">{t('playbackSpeed')}</span>
                        <span className="reel-menu-rates">
                          {RATES.map(r => (
                            <button
                              key={r}
                              type="button"
                              className={`reel-rate ${rate === r ? 'on' : ''}`}
                              aria-pressed={rate === r}
                              onClick={() => setRate(r)}
                            >
                              {r}x
                            </button>
                          ))}
                        </span>
                      </div>
                      <button type="button" className="reel-menu-item" onClick={() => { setMenuFor(null); setReporting(slide.post.id); }}>
                        {t('report')}
                      </button>
                      <button
                        type="button"
                        className="reel-menu-item danger"
                        onClick={() => { setMenuFor(null); void blockUser(slide.author.id); }}
                      >
                        {t('block')} {slide.author.name || slide.author.username}
                      </button>
                    </div>
                  )}
                  <div className="reel-rail">
                    <div className="reel-avatar">
                      <Link href={`/u/${slide.author.username}`} aria-label={slide.author.name}>
                        <Avatar user={slide.author} size={46} />
                      </Link>
                      {!own && !isBlocked(slide.author.id) && (
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
                        emptyLabel="Like"
                        extraCount={slide.post.media?.some(m => m.likes !== undefined)
                          ? slide.post.media.reduce((n, m) => n + (m.likes || 0), 0)
                          : db.reactions.filter(r => r.targetType === 'media' && r.targetId.startsWith(`${slide.post.id}#m`)).length}
                      />
                    </div>
                    <div className="reel-rail-item">
                      <button type="button" aria-label="Comment on this reel" onClick={e => { e.currentTarget.blur(); setCommentsOpen(true); }}>
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
                        onClick={e => { e.currentTarget.blur(); if (me) toggleSave(slide.post.id); else router.push('/login'); }}
                      >
                        {saved ? IC.bookmarkFill : IC.bookmark}
                      </button>
                      <span>{saveCount > 0 ? compact(saveCount) : 'Save'}</span>
                    </div>
                    <div className="reel-rail-item">
                      <button type="button" aria-label="Share this reel" onClick={e => { e.currentTarget.blur(); void shareReel(slide); }}>
                        {IC.share}
                      </button>
                      <span>{shareCount > 0 ? compact(shareCount) : 'Share'}</span>
                    </div>
                  </div>
                  <div className="reel-meta">
                    {paid && (
                      <div className="reel-promo">
                        <span className="reel-promo-chip">{IC.chart}{t('promoted')}</span>
                        <button type="button" className="reel-promo-cta" onClick={askReel}>
                          {IC.msg}
                          <span>{t('messageNow')}</span>
                        </button>
                      </div>
                    )}
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
            {!me && stream.loaded && !stream.hasMore && (
              <div className="reel-slide reel-end">
                <p>{t('keepReading')}</p>
                <Link href="/login">{t('signIn')}</Link>
              </div>
            )}
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
        {reporting && <ReportModal type="post" targetId={reporting} onClose={() => setReporting(null)} />}
        <ShareDialog
          open={!!sharing}
          url={`${typeof window === 'undefined' ? '' : window.location.origin}/video/${sharing?.post.id}-${sharing?.mediaIndex}`}
          title={`${sharing?.author.name || sharing?.author.username || ''} on Exposing`}
          text={(sharing?.post.text || '').slice(0, 140)}
          preview={sharing ? {
            title: sharing.author.name || sharing.author.username,
            subtitle: sharing.post.text.slice(0, 120),
            video: sharing.media.src || undefined,
          } : undefined}
          onShared={() => { if (sharing) void sharePost(sharing.post.id); }}
          onClose={() => setSharing(null)}
        />
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