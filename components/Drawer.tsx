'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import type { FeatureName } from '@/lib/AppContext';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';
import Avatar from './Avatar';
import BrandLogo from './BrandLogo';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function Drawer() {
  const { me, logout, drawerOpen, closeDrawer, db, updateLang, t, featureLock } = useApp();

  useBackClose(drawerOpen, closeDrawer);
  const navigateClose = () => { closeLayerWithoutBack(); closeDrawer(); };

  useEffect(() => {
    document.body.classList.toggle('noscroll', drawerOpen);
    return () => document.body.classList.remove('noscroll');
  }, [drawerOpen]);

  const links: { href: string; label: string; icon: ReactNode; gate?: FeatureName }[] = [
    ...(me ? [{ href: `/u/${me.username}`, label: t('profile'), icon: IC.user }] : []),
    { href: '/messages', label: t('messages'), icon: IC.msg, gate: 'messages' },
    { href: '/saved', label: t('saved'), icon: IC.bookmark },
    { href: '/wallet', label: t('wallet'), icon: IC.wallet, gate: 'wallet' },
    { href: '/video', label: t('video'), icon: IC.video, gate: 'video' },
    { href: '/marketplace', label: t('marketplace'), icon: IC.store, gate: 'marketplace' },
    { href: '/settings', label: t('settings'), icon: IC.gear }
  ];

  return (
    <>
      <div
        className={`drawer-overlay ${drawerOpen ? 'open' : ''}`}
        onClick={closeDrawer}
        aria-hidden={!drawerOpen}
      />
      <aside className={`drawer ${drawerOpen ? 'open' : ''}`} aria-hidden={!drawerOpen} role="dialog" aria-label="Menu">
        <div className="drawer-brand">
          <BrandLogo height={38} />
        </div>
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
          {links.map(item => {
            const lock = item.gate ? featureLock(item.gate) : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`drawer-link${lock ? ' f-off' : ''}`}
                onClick={navigateClose}
                {...(lock ? lock.props : {})}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
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