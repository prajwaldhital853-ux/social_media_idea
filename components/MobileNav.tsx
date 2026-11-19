'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, db, openDrawer, openComposer, t, feature } = useApp();
  const [query, setQuery] = useState('');
  const [compactPost, setCompactPost] = useState(false);
  const unread = me ? db.notifications.filter(n => n.uid === me.id && !n.read).length : 0;

  useEffect(() => {
    let lastY = Math.max(0, window.scrollY);
    setCompactPost(false);
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      if (y < 24) setCompactPost(false);
      else if (Math.abs(y - lastY) >= 6) setCompactPost(y > lastY);
      if (Math.abs(y - lastY) >= 6) lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  const tabs = [
    { href: '/', label: t('home'), icon: IC.home },
    ...(feature('video') ? [{ href: '/video', label: t('video'), icon: IC.video }] : []),
    { href: '/messages', label: 'Chat', icon: IC.msg },
    ...(feature('marketplace') ? [{ href: '/marketplace', label: t('marketplace'), icon: IC.store }] : []),
    { href: '/profile', label: t('profile'), icon: IC.user }
  ];

  return (
    <>
      <header className="m-top">
        <button type="button" className="mnav-circle m-drawer" onClick={openDrawer} aria-label="Open menu">{IC.menu}</button>
        <form className="m-search" role="search" onSubmit={e => {
          e.preventDefault();
          router.push(`/explore${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
        }}>
          {IC.search}
          <input type="search" aria-label="Search Exposing" placeholder="Search Exposing" value={query} onChange={e => setQuery(e.target.value)} />
        </form>
        <Link href="/notifications" className="mnav-circle" aria-label={t('notifications')}>
          {IC.bell}
          {unread > 0 && <span className="mnav-badge">{unread > 9 ? '9+' : unread}</span>}
        </Link>
      </header>

      <button type="button" className={`post-fab ${compactPost ? 'is-compact' : ''}`} onClick={() => openComposer(null)} aria-label="Create post or reel" aria-haspopup="dialog">
        <span className="post-fab-label">Post</span>
        <span className="post-fab-plus" aria-hidden="true">{IC.plus}</span>
      </button>

      <nav className="mobile-nav" aria-label="Primary mobile navigation">
        {tabs.map(tab => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href) || (tab.href === '/profile' && pathname === `/u/${me?.username}`);
          return <Link key={tab.href} href={tab.href} aria-label={tab.label} aria-current={active ? 'page' : undefined} title={tab.label} className={`mnav-tab ${active ? 'active' : ''}`}>
            {tab.icon}
          </Link>;
        })}
      </nav>
    </>
  );
}
