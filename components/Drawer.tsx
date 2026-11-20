'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';
import Avatar from './Avatar';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function Drawer() {
  const { me, isAdmin, logout, drawerOpen, closeDrawer, db, updateLang, t, feature } = useApp();

  useBackClose(drawerOpen, closeDrawer);
  const navigateClose = () => { closeLayerWithoutBack(); closeDrawer(); };

  useEffect(() => {
    document.body.classList.toggle('noscroll', drawerOpen);
    return () => document.body.classList.remove('noscroll');
  }, [drawerOpen]);

  const links = [
    ...(me ? [{ href: `/u/${me.username}`, label: t('profile'), icon: IC.user }] : []),
    { href: '/messages', label: t('messages'), icon: IC.msg },
    { href: '/saved', label: t('saved'), icon: IC.bookmark },
    { href: '/wallet', label: t('wallet'), icon: IC.wallet },
    ...(feature('video') ? [{ href: '/video', label: t('video'), icon: IC.video }] : []),
    ...(feature('marketplace') ? [{ href: '/marketplace', label: t('marketplace'), icon: IC.store }] : []),
    { href: '/settings', label: t('settings'), icon: IC.gear }
  ];

  if (isAdmin()) {
    links.push({ href: '/admin', label: t('admin'), icon: IC.shield });
  }

  return (
    <>
      <div
        className={`drawer-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={closeDrawer}
        aria-hidden={!drawerOpen}
      />
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`} aria-hidden={!drawerOpen} role="dialog" aria-label="Menu">
        <div className="drawer-head">
          <span className="drawer-title">{t('more')}</span>
          <button type="button" className="icon-btn" onClick={closeDrawer} aria-label={t('close')}>
            {IC.x}
          </button>
        </div>

        {me && (
          <Link href={`/u/${me.username}`} className="drawer-profile" onClick={navigateClose}>
            <Avatar user={me} size={48} />
            <span>
              <b>{me.name || me.username}</b>
              <span>@{me.username}</span>
            </span>
          </Link>
        )}

        <nav className="drawer-nav">
          {links.map(item => (
            <Link key={item.href} href={item.href} className="drawer-link" onClick={navigateClose}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="drawer-footer">
          <ThemeToggle />
          <button
            type="button"
            className="drawer-link"
            onClick={() => updateLang(db.lang === 'en' ? 'ne' : 'en')}
          >
            <span className="drawer-lang">{db.lang === 'en' ? 'ने' : 'EN'}</span>
            <span>{db.lang === 'en' ? 'नेपाली' : 'English'}</span>
          </button>
          {me ? (
            <button type="button" className="drawer-link danger" onClick={logout}>
              {IC.logout}
              <span>{t('logout')}</span>
            </button>
          ) : (
            <>
              <Link href="/login" className="drawer-link" onClick={navigateClose}>
                {IC.user}
                <span>{t('signIn')}</span>
              </Link>
              <Link href="/signup" className="drawer-link" onClick={navigateClose}>
                {IC.plus}
                <span>{t('signUp')}</span>
              </Link>
            </>
          )}
        </div>
      </aside>
    </>
  );
}