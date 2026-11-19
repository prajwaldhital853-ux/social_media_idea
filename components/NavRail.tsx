'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import BrandLogo from './BrandLogo';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function NavRail() {
  const { me, isAdmin, logout, openDrawer, openComposer, t, feature } = useApp();
  const pathname = usePathname();

  const navItems = [
    { icon: IC.home, label: t('home'), href: '/' },
    { icon: IC.bell, label: t('notifications'), href: '/notifications' },
    { icon: IC.search, label: t('search'), href: '/explore' },
    ...(feature('video') ? [{ icon: IC.video, label: t('video'), href: '/video' }] : []),
    ...(feature('marketplace') ? [{ icon: IC.store, label: t('marketplace'), href: '/marketplace' }] : [])
  ];

  return (
    <aside className="rail">
      <BrandLogo height={46} className="rail-brand" />

      <nav className="rail-nav" aria-label="Primary">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${pathname === item.href ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}

        <button type="button" className="nav-item" onClick={openDrawer}>
          {IC.menu}
          <span>{t('more')}</span>
        </button>
      </nav>

      <button type="button" className="post-btn" onClick={() => openComposer(null)}>
        {IC.plus}
        <span>{t('post')}</span>
      </button>

      <div className="rail-bottom">
        <ThemeToggle compact />
        {me ? (
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
        ) : (
          <div className="rail-auth">
            <Link href="/login" className="rail-signin">{t('signIn')}</Link>
            <Link href="/signup" className="rail-signup">{t('signUp')}</Link>
          </div>
        )}
        {isAdmin() && (
          <Link href="/admin" className={`nav-item rail-admin ${pathname === '/admin' ? 'active' : ''}`}>
            {IC.shield}
            <span>{t('admin')}</span>
          </Link>
        )}
      </div>
    </aside>
  );
}