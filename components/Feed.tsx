'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import { postsFragment, useList } from '@/lib/lists';
import { clearNew } from '@/lib/newCount';
import { useWindowed } from '@/lib/useWindowed';
import { canSeePost, privateIds } from '@/lib/utils';
import { useBackClose } from '@/lib/useBackClose';
import { Post } from '@/lib/types';

export default function Feed() {
  const { db, me, t, serverMode, feedTab, setFeedTab } = useApp();
  const tab = feedTab;
  const feed = useList(
    'feed',
    { path: '/feed/', frag: postsFragment(me?.id || null) },
    { following: tab === 'following' ? 1 : undefined },
  );

  const followingIds = new Set(db.follows.filter(f => f.follower === me?.id && f.status !== 'pending').map(f => f.following));
  const privates = useMemo(() => privateIds(db.users), [db.users]);
  const cached = useMemo(() => {
    const index = new Map(db.posts.map(p => [p.id, p] as [string, Post]));
    return feed.ids.map(id => index.get(id)).filter((p): p is Post => !!p);
  }, [db.posts, feed.ids]);

  // The server chooses the rows; this also drops a cached row that moderation
  // suspended after the page arrived.
  const serverPosts = cached.filter(p =>
    p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows, privates));
  const localPosts = db.posts
    .filter(p => p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows, privates) && (tab !== 'following' || followingIds.has(p.uid)))
    .sort((a, b) => b.ts - a.ts);
  const posts = serverMode ? serverPosts : localPosts;

  const { limit, pending, sentinel, hasMore } = useWindowed(posts.length, 10, tab,
    serverMode ? { hasMore: feed.hasMore, loading: feed.loading, load: feed.loadMore } : undefined);
  const filling = serverMode && feed.loading && posts.length === 0;

  // Every arrival at Home is a fresh reading, not a replay of the ids the last
  // visit left behind: page one is re-read while the rows on screen stay put,
  // so a post that went live while they were away takes the top. A cold load is
  // already a first reading, so only a return visit re-pulls here.
  const refeed = useRef(feed.reload);
  refeed.current = feed.reload;
  const returned = useRef(false);
  useEffect(() => {
    if (!serverMode) return;
    if (returned.current) refeed.current();
    returned.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A post that went live while this page was open is counted on the nav icon
  // below instead of a pill here — opening or refreshing this page is what
  // zeroes that counter, so the arrival and the looking are paired. Keyed on the
  // reading rather than on the tab, because a pull-and-release is a looking too:
  // the newest rows are on screen the moment it answers, and a badge that outlives
  // them claims news the reader has already read.
  useEffect(() => { clearNew('feed'); }, [tab, feed.pulled]);

  // A phone's back button hands this page back from the browser's own snapshot
  // without remounting anything, so the re-pull rides on pageshow instead.
  useEffect(() => {
    if (!serverMode) return;
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) refeed.current();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [serverMode]);

  // Once the reader is past the first card the tab bar slides up against the
  // top bar and thins out, which is the room the posts actually need.
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    let seen = -1;
    const onScroll = () => {
      const y = window.scrollY;
      if (y === seen) return;
      seen = y;
      setLifted(y > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Phone Back on a feed that is scrolled down is not an exit and not a trip to
  // the profile: it lifts the reader to the top, re-pulls the newest rows, and
  // leaves them on Home. Scrolling back up by hand pops the same entry.
  useBackClose(lifted, () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (serverMode) void feed.reload();
  });

  // A refresh is a rewrite of the whole page, not a top-up: the reader is lifted
  // to the top, the rows they were looking at are traded for the skeleton, and
  // what appears underneath is the newest page. The shell's pull-to-refresh asks
  // every mounted list to rebuild itself, and a rebuild empties `feed.ids` and
  // sets `loading` — which is exactly what `filling` below already draws.
  const skeleton = (
    <div className="feed-skeleton" aria-hidden="true">
      <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
      <div className="sk-block" />
      <div className="sk-lines wide"><i /><i /></div>
    </div>
  );

  return (
    <>
      <header className={`header home-header ${lifted ? 'lifted' : ''}`}>
        <div className="tabs" role="tablist" aria-label="Feed">
          <button type="button" role="tab" aria-selected={tab === 'foryou'} className={`tab ${tab === 'foryou' ? 'active' : ''}`} onClick={() => setFeedTab('foryou')}>{t('forYou')}</button>
          <button type="button" role="tab" aria-selected={tab === 'following'} className={`tab ${tab === 'following' ? 'active' : ''}`} onClick={() => setFeedTab('following')}>{t('following')}</button>
        </div>
      </header>
      {tab === 'following' && !me ? (
        <div className="feed-empty"><p>{t('followingSignIn')}</p><Link href="/login">{t('signIn')}</Link></div>
      ) : feed.error ? (
        <div className="feed-empty">
          <p>{feed.error}</p>
          <button type="button" className="ghost-btn" onClick={() => feed.reload()}>{t('retry')}</button>
        </div>
      ) : filling ? (
        <>{skeleton}{skeleton}</>
      ) : posts.length === 0 ? (
        // Two different empties: an empty follow list, and a full one whose
        // accounts have simply not posted. Only the first is a hint to search.
        <div className="feed-empty">
          <p>{tab === 'following' && followingIds.size > 0 ? t('followingQuiet') : t('followingEmpty')}</p>
          <Link href="/explore">{t('findPeople')}</Link>
        </div>
      ) : posts.slice(0, limit).map(post => {
        const author = db.users.find(u => u.id === post.uid);
        return author ? <PostCard key={post.id} post={post} author={author} /> : null;
      })}
      {!serverMode || me || feed.error || feed.loading || hasMore || !posts.length ? null : (
        <div className="feed-empty">
          <p>{t('keepReading')}</p>
          <Link href="/login">{t('signIn')}</Link>
        </div>
      )}
      {pending && hasMore && !filling && skeleton}
      {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
    </>
  );
}
