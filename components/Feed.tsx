'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import { postsFragment, useList } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { canSeePost, privateIds } from '@/lib/utils';
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
  const serverPosts = cached.filter(p =>
    (p.status === 'live' || me?.id === p.uid || isStaff()) && canSeePost(p, me?.id ?? null, db.follows, privates));
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
        <div className="feed-skeleton" aria-hidden="true">
          <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
          <div className="sk-block" />
          <div className="sk-lines wide"><i /><i /></div>
        </div>
      ) : posts.length === 0 ? (
        <div className="feed-empty"><p>{t('followingEmpty')}</p><Link href="/explore">{t('findPeople')}</Link></div>
      ) : posts.slice(0, limit).map(post => {
        const author = db.users.find(u => u.id === post.uid);
        return author ? <PostCard key={post.id} post={post} author={author} /> : null;
      })}
      {pending && hasMore && (
        <div className="feed-skeleton" aria-hidden="true">
          <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
          <div className="sk-block" />
          <div className="sk-lines wide"><i /><i /></div>
        </div>
      )}
      {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
    </>
  );
}
