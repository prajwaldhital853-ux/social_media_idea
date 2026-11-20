'use client';

import Link from 'next/link';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import ThemeToggle from '@/components/ThemeToggle';
import { useApp } from '@/lib/AppContext';
import { canSeePost } from '@/lib/utils';
import { IC } from '@/lib/icons';

export default function SavedPage() {
  const { db, me, t } = useApp();

  const savedPosts = me
    ? db.saves
        .filter(s => s.uid === me.id)
        .sort((a, b) => b.ts - a.ts)
        .map(s => db.posts.find(p => p.id === s.pid))
        .filter((p): p is NonNullable<typeof p> => !!p && p.status === 'live' && canSeePost(p, me.id, db.follows))
    : [];

  return (
    <AppShell>
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <div className="header-title">{t('savedPosts')}</div>
            <p className="header-sub">{t('savedSub')}</p>
          </div>
          <div className="header-actions"><ThemeToggle compact /></div>
        </div>
      </header>

      {!me ? (
        <div className="feed-empty">
          <p>{t('needLogin')}</p>
          <Link href="/login">{t('signIn')}</Link>
        </div>
      ) : savedPosts.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.bookmark}</span>
          <h2>{t('noSaved')}</h2>
          <p>{t('savedSub')}</p>
          <Link className="empty-state-cta" href="/">{t('backFeed')}</Link>
        </div>
      ) : (
        <div className="saved-list">
          {savedPosts.map(post => {
            const author = db.users.find(u => u.id === post.uid);
            return author ? <PostCard key={post.id} post={post} author={author} /> : null;
          })}
        </div>
      )}
    </AppShell>
  );
}