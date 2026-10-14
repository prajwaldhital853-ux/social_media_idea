'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function TwitterSidebar() {
  const { me, isAdmin, logout, openDrawer } = useApp();
  const pathname = usePathname();

  const navItems = [
    { icon: IC.home, label: 'Home', href: '/' },
    { icon: IC.vmarket, label: 'Video Marketplace', href: '/marketplace' },
    { icon: IC.bell, label: 'Notifications', href: '/notifications' },
    { icon: IC.msg, label: 'Messages', href: '/messages' },
    { icon: IC.user, label: 'Profile', href: '/profile' }
  ];

  if (isAdmin()) {
    navItems.push({ icon: IC.menu, label: 'Admin', href: '/admin' });
  }

  return (
    <aside className="rail">
      <Link href="/" className="rail-brand" aria-label="Chautari home">
        {IC.logo}
        <span className="rail-brand-copy">
          <b>Chautari</b>
          <span>Stories from the square</span>
        </span>
      </Link>

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
        <span>More</span>
      </button>

      <button type="button" className="post-btn">
        {IC.plus}
        <span>Post</span>
      </button>

      <div className="rail-card">
        <h3>Around the square</h3>
        <p>Pokhara light, Kathmandu rain, and kitchen steam — today&apos;s Chautari is full.</p>
        <div className="rail-chips">
          <span className="rail-chip">#Pokhara</span>
          <span className="rail-chip">#Himal</span>
          <span className="rail-chip">#Momo</span>
        </div>
      </div>

      <div className="rail-bottom">
        <ThemeToggle compact />
        {me ? (
          <div className="rail-user">
            <Avatar user={me} size={40} />
            <div className="rail-user-meta">
              <div className="rail-user-name">{me.name || me.username}</div>
              <div className="rail-user-handle">@{me.username}</div>
            </div>
            <button type="button" className="icon-btn" onClick={logout} aria-label="Log out">
              {IC.x}
            </button>
          </div>
        ) : (
          <Link href="/login" className="nav-item">
            {IC.user}
            <span>Sign in</span>
          </Link>
        )}
      </div>
    </aside>
  );
}
