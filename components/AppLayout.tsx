'use client';

import { ReactNode } from 'react';
import SideRail from './SideRail';
import TopBar from './TopBar';
import { useApp } from '@/lib/AppContext';
import { I18N } from '@/lib/i18n';
import { IC } from '@/lib/icons';

interface AppLayoutProps {
  children: ReactNode;
  currentRoute: string;
}

export default function AppLayout({ children, currentRoute }: AppLayoutProps) {
  const { db } = useApp();
  const t = (key: keyof typeof I18N.en) => I18N[db.lang][key] || I18N.en[key];

  return (
    <div className="shell">
      <SideRail currentRoute={currentRoute} />
      <main className="main">
        <TopBar />
        {children}
        <p className="foot">{t('footer')}</p>
      </main>
      <button className="fab" aria-label={t('post')}>
        {IC.plus}
        <span>{t('post')}</span>
      </button>
    </div>
  );
}
