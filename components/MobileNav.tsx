'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';

export default function MobileNav() {
  const pathname = usePathname();
  const { openDrawer } = useApp();

  const items = [
    { href: '/', label: 'Home', icon: IC.home },
    { href: '/explore', label: 'Explore', icon: IC.search },
    { href: '/notifications', label: 'Alerts', icon: IC.bell },
    { href: '/messages', label: 'Inbox', icon: IC.msg }
  ];

  return (
    <nav className="mobile-nav" aria-label="Primary">
      {items.map(item => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={`mobile-nav-item ${active ? 'active' : ''}`}>
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button type="button" className="mobile-nav-item" onClick={openDrawer} aria-label="Open menu">
        {IC.menu}
        <span>Menu</span>
      </button>
    </nav>
  );
}
