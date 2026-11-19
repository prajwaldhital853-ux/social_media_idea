'use client';

import AppShell from './AppShell';
import ThemeToggle from './ThemeToggle';

export default function SimplePage({ title, note }: { title: string; note: string }) {
  return (
    <AppShell>
      <header className="header home-header">
        <div className="home-header-row">
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
    </AppShell>
  );
}