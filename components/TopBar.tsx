'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import BrandLogo from './BrandLogo';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function TopBar() {
  const { me, db, t } = useApp();
  const pathname = usePathname();
  const unreadMsg = db.unread ? db.unread.messages : (me ? db.messages.filter(m => m.to === me.id && !m.read).length : 0);
  const unreadNotif = db.unread ? db.unread.notifications : (me ? db.notifications.filter(n => n.uid === me.id && !n.read).length : 0);
  const badge = (n: number) => (n > 9 ? '9+' : String(n));

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link href="/" className="topbar-brand" aria-label="Exposing home">
          <BrandLogo height={30} />
        </Link>
        <Link href="/explore" className="topbar-search" aria-label={t('search')}>
          {IC.search}
          <span>Search Exposing</span>
        </Link>
        <ThemeToggle compact />
      </div>
      <div className="topbar-right">
        <Link
          href="/video"
          className={`topbar-icon ${pathname.startsWith('/video') ? 'active' : ''}`}
          aria-label={t('video')}
          title={t('video')}
        >
          {IC.video}
        </Link>
        <Link
          href="/messages"
          className={`topbar-icon ${pathname.startsWith('/messages') ? 'active' : ''}`}
          aria-label={t('messages')}
          title={t('messages')}
        >
          {IC.msg}
          {unreadMsg > 0 && <span className="topbar-badge">{badge(unreadMsg)}</span>}
        </Link>
        <Link
          href="/notifications"
          className={`topbar-icon ${pathname.startsWith('/notifications') ? 'active' : ''}`}
          aria-label={t('notifications')}
          title={t('notifications')}
        >
          {IC.bell}
          {unreadNotif > 0 && <span className="topbar-badge">{badge(unreadNotif)}</span>}
        </Link>
      </div>
    </header>
  );
}