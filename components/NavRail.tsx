'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

export default function NavRail() {
  const { me, logout, openDrawer, t, feature, openCreateChooser, theme, toggleTheme, updateLang, db } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const isDark = theme === 'dark';

  const navItems = [
    { icon: IC.home, label: t('home'), href: '/' },
    { icon: IC.bell, label: t('notifications'), href: '/notifications' },
    { icon: IC.search, label: t('search'), href: '/explore' },
    ...(feature('video') ? [{ icon: IC.video, label: t('video'), href: '/video' }] : []),
    ...(feature('marketplace') ? [{ icon: IC.store, label: t('marketplace'), href: '/marketplace' }] : [])
  ];

  return (
    <aside className="rail">
      <nav className="rail-nav" aria-label="Primary">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/')) ? 'active' : ''}`}
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

      <div className="rail-extra">
        <Link href="/messages" className={`nav-item secondary ${pathname.startsWith('/messages') ? 'active' : ''}`}>
          {IC.msg}
          <span>{t('messages')}</span>
        </Link>
        <Link href="/saved" className={`nav-item secondary ${pathname.startsWith('/saved') ? 'active' : ''}`}>
          {IC.bookmark}
          <span>{t('saved')}</span>
        </Link>
        <Link href="/wallet" className={`nav-item secondary ${pathname.startsWith('/wallet') ? 'active' : ''}`}>
          {IC.wallet}
          <span>{t('wallet')}</span>
        </Link>
        <Link href="/settings" className={`nav-item secondary ${pathname.startsWith('/settings') ? 'active' : ''}`}>
          {IC.gear}
          <span>{t('settings')}</span>
        </Link>
        <button type="button" className="nav-item secondary" onClick={toggleTheme}>
          {isDark ? IC.sun : IC.moon}
          <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <button type="button" className="nav-item secondary" onClick={() => updateLang(db.lang === 'en' ? 'ne' : 'en')}>
          <span className="rail-extra-lang">{db.lang === 'en' ? 'ने' : 'EN'}</span>
          <span>{db.lang === 'en' ? 'नेपाली' : 'English'}</span>
        </button>
      </div>
    </aside>
  );
}