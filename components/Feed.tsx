'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PostCard from '@/components/PostCard';
import PullToRefresh from '@/components/PullToRefresh';
import { useApp } from '@/lib/AppContext';
import { postsFragment, useList } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { canSeePost, privateIds } from '@/lib/utils';
import { useBackClose } from '@/lib/useBackClose';
import { Post } from '@/lib/types';

export default function Feed() {
  const { db, me, t, isStaff, serverMode, feedTab, setFeedTab } = useApp();
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

  // The server has already chosen the rows; this pass only keeps staff/self
  // visibility honest for rows that were cached before something changed.
  // Staff get the same deal the API gives them: the moderation view is the
  // point, so a followers-only post from someone they do not follow is a row
  // they are supposed to see, not one to filter back out.
  const staff = isStaff();
  const serverPosts = cached.filter(p =>
    staff || ((p.status === 'live' || me?.id === p.uid) && canSeePost(p, me?.id ?? null, db.follows, privates)));
  const localPosts = db.posts
    .filter(p => (p.status === 'live' || me?.id === p.uid || isStaff()) && canSeePost(p, me?.id ?? null, db.follows, privates) && (tab !== 'following' || followingIds.has(p.uid)))
    .sort((a, b) => b.ts - a.ts);
  const posts = serverMode ? serverPosts : localPosts;

  const { limit, pending, sentinel, hasMore } = useWindowed(posts.length, 10, tab,
    serverMode ? { hasMore: feed.hasMore, loading: feed.loading, load: feed.loadMore } : undefined);
  const filling = serverMode && feed.loading && posts.length === 0;

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

  // The demo build reads its own cache, so there is nothing to re-pull — but the
  // gesture still has to land somewhere, and a spinner that snaps straight back
  // reads as a broken control rather than an up-to-date list.
  //
  // A refresh is a rewrite of the whole page, not a top-up: the reader is lifted
  // to the top, the rows they were looking at are traded for the skeleton, and
  // what appears underneath is the newest page. `feed.reload()` deliberately
  // keeps the old rows on screen, so the swap is decided here.
  const [pulled, setPulled] = useState(false);
  const refresh = async () => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setPulled(true);
    try {
      if (serverMode) await feed.reload();
      else await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      setPulled(false);
    }
  };

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
      <PullToRefresh onRefresh={() => refresh} />
      {tab === 'following' && !me ? (
        <div className="feed-empty"><p>{t('followingSignIn')}</p><Link href="/login">{t('signIn')}</Link></div>
      ) : feed.error ? (
        <div className="feed-empty">
          <p>{feed.error}</p>
          <button type="button" className="ghost-btn" onClick={() => feed.reload()}>{t('retry')}</button>
        </div>
      ) : pulled ? (
        <>{skeleton}{skeleton}</>
      ) : filling ? (
        skeleton
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
      {pending && hasMore && !pulled && skeleton}
      {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
    </>
  );
}
