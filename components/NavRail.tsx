'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import type { FeatureName } from '@/lib/AppContext';
import { useNewCount } from '@/lib/newCount';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

type RailItem = { icon: ReactNode; label: string; href: string; badge?: number; plus?: boolean; gate?: FeatureName };

export default function NavRail() {
  const { me, db, logout, t, featureLock, openCreateChooser } = useApp();
  const pathname = usePathname();
  const router = useRouter();

  // The top bar owns these counts on a phone; on a desktop the rail is the only
  // column that never scrolls away, so the unread threads belong here too.
  const unreadMsg = db.unread ? db.unread.messages : (me ? db.messages.filter(m => m.to === me.id && !m.read).length : 0);
  const feedNew = useNewCount('feed');
  const reelsNew = useNewCount('reels');
  const walletOff = featureLock('wallet');

  const navItems: RailItem[] = [
    { icon: IC.home, label: t('home'), href: '/', badge: feedNew, plus: true },
    { icon: IC.bell, label: t('notifications'), href: '/notifications' },
    { icon: IC.msg, label: t('messages'), href: '/messages', badge: unreadMsg, gate: 'messages' },
    { icon: IC.search, label: t('search'), href: '/explore' },
    { icon: IC.video, label: t('video'), href: '/video', badge: reelsNew, plus: true, gate: 'video' },
    { icon: IC.store, label: t('marketplace'), href: '/marketplace', gate: 'marketplace' },
  ];

  return (
    <aside className="rail">
      <nav className="rail-nav" aria-label="Primary">
        {navItems.map(item => {
          const lock = item.gate ? featureLock(item.gate) : null;
          return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/')) ? 'active' : ''}${lock ? ' f-off' : ''}`}
            {...(lock ? lock.props : {})}
          >
            <span className="nav-ico">
              {item.icon}
              {!!item.badge && !lock && (
                <span className={`nav-badge ${item.plus ? 'nav-badge-new' : ''}`}>
                  {item.plus ? (item.badge > 99 ? '99+' : `+${item.badge}`) : (item.badge > 9 ? '9+' : item.badge)}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </Link>
          );
        })}
      </nav>

      <div className="rail-foot">
        <Link href="/saved" className={`nav-item ${pathname.startsWith('/saved') ? 'active' : ''}`}>
          {IC.bookmark}
          <span>{t('saved')}</span>
        </Link>
        <Link href="/wallet" className={`nav-item ${pathname.startsWith('/wallet') ? 'active' : ''}${walletOff ? ' f-off' : ''}`} {...(walletOff ? walletOff.props : {})}>
          {IC.wallet}
          <span>{t('wallet')}</span>
        </Link>
        <Link href="/settings" className={`nav-item ${pathname.startsWith('/settings') ? 'active' : ''}`}>
          {IC.gear}
          <span>{t('settings')}</span>
        </Link>

        <button
          type="button"
          className="post-btn"
          onClick={() => me ? openCreateChooser() : router.push('/login')}
        >
          {IC.plus}
          <span>{t('post')}</span>
        </button>

        <div className="rail-bottom">
          {me && (
            <div className="rail-user">
              <Link href={`/u/${me.username}`} className="rail-user-link">
                <Avatar user={me} size={40} />
                <span className="rail-user-meta">
                  <span className="rail-user-name">{me.name || me.username}</span>
                  <span className="rail-user-handle">@{me.username}</span>
                </span>
              </Link>
              <button type="button" className="icon-btn" onClick={logout} aria-label={t('logout')} title={t('logout')}>
                {IC.logout}
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}