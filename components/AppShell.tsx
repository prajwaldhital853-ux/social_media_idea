'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import NavRail from './NavRail';
import Drawer from './Drawer';
import MobileNav from './MobileNav';
import SiteFooter from './SiteFooter';
import Toast from './Toast';
import Avatar from './Avatar';
import CreatePostModal from './CreatePostModal';
import { IC } from '@/lib/icons';
import { compact } from '@/lib/utils';

function RightWidgets() {
  const { db, me, t, isFollowing, toggleFollow } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');

  const trends = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of db.posts) {
      if (p.status !== 'live') continue;
      for (const m of Array.from(p.text.matchAll(new RegExp('#([\\p{L}\\p{N}_]+)', 'gu')))) {
        const tag = m[1];
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [db.posts]);

  const suggestions = useMemo(() => {
    const followerCount = (id: string) => db.follows.filter(f => f.following === id).length;
    return db.users
      .filter(u => u.role === 'user' && u.id !== me?.id && !isFollowing(u.id))
      .sort((a, b) => followerCount(b.id) - followerCount(a.id))
      .slice(0, 3);
  }, [db.users, db.follows, me, isFollowing]);

  return (
    <aside className="widgets">
      <form
        className="search-box"
        onSubmit={e => {
          e.preventDefault();
          if (q.trim()) router.push(`/explore?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <span className="search-icon">{IC.search}</span>
        <input
          type="search"
          className="search-input"
          placeholder={t('search')}
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label={t('search')}
        />
      </form>

      {trends.length > 0 && (
        <div className="widget">
          <div className="widget-header">Trending on Exposing</div>
          {trends.map(([tag, n]) => (
            <Link key={tag} href={`/explore?q=${encodeURIComponent('#' + tag)}`} className="trend-item">
              <div className="trend-meta">Trending in Nepal</div>
              <div className="trend-name">#{tag}</div>
              <div className="trend-count">{compact(n)} {n === 1 ? 'post' : 'posts'}</div>
            </Link>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="widget">
          <div className="widget-header">Who to follow</div>
          {suggestions.map(u => (
            <div key={u.id} className="suggest-row">
              <Link href={`/u/${u.username}`} className="suggest-user">
                <Avatar user={u} size={40} />
                <span className="suggest-meta">
                  <b>{u.name}</b>
                  <span>@{u.username}</span>
                </span>
              </Link>
              {me ? (
                <button type="button" className="follow-chip" onClick={() => toggleFollow(u.id)}>
                  {t('follow')}
                </button>
              ) : (
                <Link href="/login" className="follow-chip">{t('follow')}</Link>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="widget widget-note">
        <p>{t('tagline')}</p>
      </div>
    </aside>
  );
}

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const focusedPage = pathname.startsWith('/post/') || pathname === '/explore';
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <div className={`shell ${focusedPage ? 'focused-page' : ''}`}>
      <NavRail />
      <main className="main">
        {children}
        {!focusedPage && <SiteFooter />}
      </main>
      <RightWidgets />
      <Drawer />
      <MobileNav />
      <CreatePostModal />
      <Toast />
    </div>
  );
}