'use client';

import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

export default function TwitterSidebar() {
  const { me, isAdmin, logout, db, updateLang } = useApp();

  const navItems = [
    { icon: IC.logo, label: 'Home', href: '/' },
    { icon: (
      <svg viewBox="0 0 24 24">
        <path d="M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z" />
      </svg>
    ), label: 'Explore', href: '/explore' },
    { icon: (
      <svg viewBox="0 0 24 24">
        <path d="M21.697 16.468c-.02-.016-2.14-1.64-2.103-6.03.02-2.532-.812-4.782-2.347-6.335C15.872 2.71 14.01 1.94 12.005 1.93h-.013c-2.004.01-3.866.78-5.242 2.174-1.534 1.553-2.368 3.802-2.346 6.334.037 4.33-2.02 5.967-2.102 6.03-.26.193-.366.53-.265.84.099.308.376.508.694.508h15.997c.314 0 .59-.197.692-.502.101-.313-.003-.646-.263-.846zM12 20.75h-8.5c-.965 0-1.75-.785-1.75-1.75s.785-1.75 1.75-1.75h8.5c.965 0 1.75.785 1.75 1.75s-.785 1.75-1.75 1.75z" />
      </svg>
    ), label: 'Notifications', href: '/notifications' },
    { icon: (
      <svg viewBox="0 0 24 24">
        <path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z" />
      </svg>
    ), label: 'Messages', href: '/messages' },
    { icon: (
      <svg viewBox="0 0 24 24">
        <path d="M5.651 19h12.698c-.337-1.8-1.023-3.21-1.945-4.19C15.318 13.65 13.838 13 12 13s-3.317.65-4.404 1.81c-.922.98-1.608 2.39-1.945 4.19zm.486-5.56C7.627 11.85 9.648 11 12 11s4.373.85 5.863 2.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H3.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46zM12 4c-1.105 0-2 .9-2 2s.895 2 2 2 2-.9 2-2-.895-2-2-2zm0-2c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z" />
      </svg>
    ), label: 'Profile', href: '/profile' },
  ];

  if (isAdmin()) {
    navItems.push({ icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 4.5C3 3.12 4.12 2 5.5 2h13C19.88 2 21 3.12 21 4.5v15c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 22 3 20.88 3 19.5v-15zM5.5 4c-.28 0-.5.22-.5.5v15c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-15c0-.28-.22-.5-.5-.5h-13zM16 10H8V8h8v2zm-8 2h8v2H8v-2z" />
      </svg>
    ), label: 'Admin', href: '/admin' });
  }

  const toggleTheme = () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  };

  return (
    <aside className="rail">
      {navItems.map((item, index) => (
        <Link key={index} href={item.href} className="nav-item">
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}

      <button className="post-btn">
        {IC.plus}
        <span>Post</span>
      </button>

      <div style={{ marginTop: 'auto' }}>
        <button
          onClick={toggleTheme}
          className="nav-item"
          style={{ width: 'fit-content', padding: '12px' }}
          title="Toggle theme"
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
            <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-2c3.87 0 7 3.13 7 7s-3.13 7-7 7-3.87-7-7-7-7 3.13-7 7zm0 14c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8 8-3.58 8-8 8zm0-16c5.52 0 10 4.48 10 10s-4.48 10-10 10-10-4.48-10-10-10-10 4.48-10 10-10z" />
          </svg>
        </button>

        {me ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '9999px', cursor: 'pointer', transition: 'background 0.2s' }}>
            <Avatar user={me} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>{me.name || me.username}</div>
              <div style={{ color: 'var(--muted)', fontSize: '15px' }}>@{me.username}</div>
            </div>
            <button onClick={logout} style={{ padding: '8px', borderRadius: '50%', transition: 'background 0.2s' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--muted)">
                <path d="M3 4.5C3 3.12 4.12 2 5.5 2h13C19.88 2 21 3.12 21 4.5v15c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 22 3 20.88 3 19.5v-15zM5.5 4c-.28 0-.5.22-.5.5v15c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-15c0-.28-.22-.5-.5-.5h-13zM16 10H8V8h8v2zm-8 2h8v2H8v-2z" />
              </svg>
            </button>
          </div>
        ) : (
          <Link href="/login" className="nav-item">
            <svg viewBox="0 0 24 24">
              <path d="M5.651 19h12.698c-.337-1.8-1.023-3.21-1.945-4.19C15.318 13.65 13.838 13 12 13s-3.317.65-4.404 1.81c-.922.98-1.608 2.39-1.945 4.19zm.486-5.56C7.627 11.85 9.648 11 12 11s4.373.85 5.863 2.44c1.477 1.58 2.366 3.8 2.632 6.46l.11 1.1H3.395l.11-1.1c.266-2.66 1.155-4.88 2.632-6.46zM12 4c-1.105 0-2 .9-2 2s.895 2 2 2 2-.9 2-2-.895-2-2-2zm0-2c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z" />
            </svg>
            <span>Sign in</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
