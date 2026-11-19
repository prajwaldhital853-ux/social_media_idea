'use client';

import { useState } from 'react';
import Link from 'next/link';
import PostCard from '@/components/PostCard';
import { useApp } from '@/lib/AppContext';
import ThemeToggle from './ThemeToggle';

export default function Feed() {
  const { db, me, t, isStaff, openComposer } = useApp();
  const [tab, setTab] = useState<'foryou' | 'following'>('foryou');
  const followingIds = new Set(db.follows.filter(f => f.follower === me?.id).map(f => f.following));
  const visiblePosts = db.posts
    .filter(p => (p.status === 'live' || me?.id === p.uid || isStaff()) && (tab !== 'following' || followingIds.has(p.uid)))
    .sort((a, b) => b.ts - a.ts);

  return (
    <>
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <div className="header-title">{t('home')}</div>
            <p className="header-sub">{t('feedSub')}</p>
          </div>
          <ThemeToggle compact />
        </div>
        <div className="tabs" role="tablist" aria-label="Feed">
          <button type="button" role="tab" aria-selected={tab === 'foryou'} className={`tab ${tab === 'foryou' ? 'active' : ''}`} onClick={() => setTab('foryou')}>{t('forYou')}</button>
          <button type="button" role="tab" aria-selected={tab === 'following'} className={`tab ${tab === 'following' ? 'active' : ''}`} onClick={() => setTab('following')}>{t('following')}</button>
        </div>
      </header>
      <div className="desktop-compose desktop-only">
        <button type="button" onClick={() => openComposer(null)}>Create a post or reel</button>
      </div>
      {tab === 'following' && !me ? (
        <div className="feed-empty"><p>Sign in to see posts from people you follow.</p><Link href="/login">{t('signIn')}</Link></div>
      ) : visiblePosts.length === 0 ? (
        <div className="feed-empty"><p>{t('followingEmpty')}</p><Link href="/explore">Find people</Link></div>
      ) : visiblePosts.map(post => {
        const author = db.users.find(u => u.id === post.uid);
        return author ? <PostCard key={post.id} post={post} author={author} /> : null;
      })}
    </>
  );
}
