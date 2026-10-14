'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';

export default function MobileNav() {
  const pathname = usePathname();
  const { openDrawer, theme, toggleTheme } = useApp();

  const tabs = [
    { href: '/', label: 'Home', icon: IC.home },
    { href: '/marketplace', label: 'Video Marketplace', icon: IC.vmarket },
    { href: '/messages', label: 'Inbox', icon: IC.msg },
    { href: '/notifications', label: 'Alerts', icon: IC.bell },
    { href: '/profile', label: 'Profile', icon: IC.user }
  ];

  return (
    <nav className="mobile-nav" aria-label="Primary">
      <div className="mnav-top">
        <Link href="/" className="mnav-brand">chautari</Link>
        <div className="mnav-actions">
          <Link href="/explore" className="mnav-circle" aria-label="Search">{IC.search}</Link>
          <button type="button" className="mnav-circle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? IC.sun : IC.moon}
          </button>
          <button type="button" className="mnav-circle" onClick={openDrawer} aria-label="Open menu">{IC.menu}</button>
        </div>
      </div>
      <div className="mnav-tabs">
        {tabs.map(t => {
          const active = pathname === t.href;
          return (
            <Link key={t.href} href={t.href} aria-label={t.label} title={t.label} className={`mnav-tab ${active ? 'active' : ''}`}>
              {t.icon}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}