'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import ThemeToggle from './ThemeToggle';
import BrandLogo from './BrandLogo';

export default function MobileNav({ barOnly = false }: { barOnly?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, db, openDrawer, t, feature, openCreateChooser } = useApp();
  const focusedPage = pathname.startsWith('/post/') || pathname === '/explore' || pathname === '/create';
  const inChat = /^\/messages\/[^/]+/.test(pathname);
  const [compactPost, setCompactPost] = useState(false);
  const unread = db.unread ? db.unread.notifications : (me ? db.notifications.filter(n => n.uid === me.id && !n.read).length : 0);

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

  const profileHref = me ? `/u/${me.username}` : '/login';
  const tabs = [
    { href: '/', label: t('home'), icon: IC.home, self: false },
    ...(feature('video') ? [{ href: '/video', label: t('video'), icon: IC.video, self: false }] : []),
    { href: '/messages', label: 'Chat', icon: IC.msg, self: false },
    ...(feature('marketplace') ? [{ href: '/marketplace', label: t('marketplace'), icon: IC.store, self: false }] : []),
    // The tab is the profile itself. Routing it through /profile rendered an
    // empty page for a beat and then replaced it, which read as a refresh.
    { href: profileHref, label: t('profile'), icon: IC.user, self: true },
  ];

  if (focusedPage || inChat) return null;

  if (barOnly) {
    return (
      <nav className="mobile-nav" aria-label="Primary mobile navigation">
        {tabs.map(tab => {
          const active = tab.href === '/' ? pathname === '/' : tab.self ? pathname === profileHref : pathname.startsWith(tab.href);
          return <Link key={tab.href} href={tab.href} aria-label={tab.label} aria-current={active ? 'page' : undefined} title={tab.label} className={`mnav-tab ${active ? 'active' : ''}`}>
            {tab.icon}
          </Link>;
        })}
      </nav>
    );
  }

  return (
    <>
      <header className="m-top">
        <button type="button" className="mnav-circle m-drawer" onClick={openDrawer} aria-label="Open menu">{IC.menu}</button>
        <BrandLogo height={30} className="m-brand" />
        <Link className="m-search" href="/explore" aria-label="Search Exposing">{IC.search}<span>Search Exposing</span></Link>
        <Link href="/notifications" className="mnav-circle" aria-label={t('notifications')}>
          {IC.bell}
          {unread > 0 && <span className="mnav-badge">{unread > 9 ? '9+' : unread}</span>}
        </Link>
        <ThemeToggle compact />
      </header>

      {pathname === '/' && <button
        type="button"
        className={`post-fab ${compactPost ? 'is-compact' : ''}`}
        onClick={() => me ? openCreateChooser() : router.push('/login')}
        aria-label="Create post or reel"
        aria-haspopup="dialog"
      >
        <span className="post-fab-label">Post</span>
        <span className="post-fab-plus" aria-hidden="true">{IC.plus}</span>
      </button>}

      <nav className="mobile-nav" aria-label="Primary mobile navigation">
        {tabs.map(tab => {
          const active = tab.href === '/' ? pathname === '/' : tab.self ? pathname === profileHref : pathname.startsWith(tab.href);
          return <Link key={tab.href} href={tab.href} aria-label={tab.label} aria-current={active ? 'page' : undefined} title={tab.label} className={`mnav-tab ${active ? 'active' : ''}`}>
            {tab.icon}
          </Link>;
        })}
      </nav>
    </>
  );
}
