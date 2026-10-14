'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function Drawer() {
  const { me, isAdmin, logout, drawerOpen, closeDrawer, db, updateLang } = useApp();

  useEffect(() => {
    document.body.classList.toggle('noscroll', drawerOpen);
    return () => document.body.classList.remove('noscroll');
  }, [drawerOpen]);

  const links = [
    { href: '/', label: 'Home', icon: IC.home },
    { href: '/explore', label: 'Explore', icon: IC.search },
    { href: '/notifications', label: 'Notifications', icon: IC.bell },
    { href: '/messages', label: 'Messages', icon: IC.msg },
    { href: '/profile', label: 'Profile', icon: IC.user }
  ];

  if (isAdmin()) {
    links.push({ href: '/admin', label: 'Admin', icon: IC.menu });
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
          <span className="drawer-title">Menu</span>
          <button type="button" className="icon-btn" onClick={closeDrawer} aria-label="Close menu">
            {IC.x}
          </button>
        </div>

        {me && (
          <div className="drawer-profile">
            <Avatar user={me} size={48} />
            <div>
              <b>{me.name || me.username}</b>
              <span>@{me.username}</span>
            </div>
          </div>
        )}

        <nav className="drawer-nav">
          {links.map(item => (
            <Link key={item.href} href={item.href} className="drawer-link" onClick={closeDrawer}>
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
              Log out
            </button>
          ) : (
            <Link href="/login" className="drawer-link" onClick={closeDrawer}>
              Log in
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
