'use client';

import { useState } from 'react';
import Link from 'next/link';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import { useWindowed } from '@/lib/useWindowed';
import { canSeePost } from '@/lib/utils';

export default function Feed() {
  const { db, me, t, isStaff } = useApp();
  const [tab, setTab] = useState<'foryou' | 'following'>('foryou');
  const followingIds = new Set(db.follows.filter(f => f.follower === me?.id && f.status !== 'pending').map(f => f.following));
  const visiblePosts = db.posts
    .filter(p => (p.status === 'live' || me?.id === p.uid || isStaff()) && canSeePost(p, me?.id ?? null, db.follows) && (tab !== 'following' || followingIds.has(p.uid)))
    .sort((a, b) => b.ts - a.ts);
  const { limit, pending, sentinel, hasMore } = useWindowed(visiblePosts.length, 10, tab);

  return (
    <>
      <header className="header home-header">
        <div className="tabs" role="tablist" aria-label="Feed">
          <button type="button" role="tab" aria-selected={tab === 'foryou'} className={`tab ${tab === 'foryou' ? 'active' : ''}`} onClick={() => setTab('foryou')}>{t('forYou')}</button>
          <button type="button" role="tab" aria-selected={tab === 'following'} className={`tab ${tab === 'following' ? 'active' : ''}`} onClick={() => setTab('following')}>{t('following')}</button>
        </div>
      </header>
      {tab === 'following' && !me ? (
        <div className="feed-empty"><p>Sign in to see posts from people you follow.</p><Link href="/login">{t('signIn')}</Link></div>
      ) : visiblePosts.length === 0 ? (
        <div className="feed-empty"><p>{t('followingEmpty')}</p><Link href="/explore">Find people</Link></div>
      ) : visiblePosts.slice(0, limit).map(post => {
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