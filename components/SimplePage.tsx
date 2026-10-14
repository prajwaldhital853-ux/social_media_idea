'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import TwitterLayout from './TwitterLayout';
import ThemeToggle from './ThemeToggle';
import { IC } from '@/lib/icons';

export default function SimplePage({ title, note }: { title: string; note: string }) {
  const { isAuthenticated, openDrawer, me } = useApp();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !isAuthenticated) router.push('/login');
  }, [mounted, isAuthenticated, router]);

  if (!mounted || !isAuthenticated) return null;

  return (
    <TwitterLayout>
      <header className="header home-header">
        <div className="home-header-row">
          <button type="button" className="header-menu" onClick={openDrawer} aria-label="Open menu">
            {me ? null : IC.menu}
            {me && <span style={{ display: 'flex' }}>{IC.menu}</span>}
          </button>
          <div className="home-header-copy">
            <div className="header-title">{title}</div>
            <p className="header-sub">{note}</p>
          </div>
          <div className="header-actions">
            <ThemeToggle compact />
          </div>
        </div>
      </header>
      <p style={{ padding: 24, color: 'var(--muted)' }}>{note}</p>
    </TwitterLayout>
  );
}
