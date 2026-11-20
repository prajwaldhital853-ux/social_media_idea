'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import AppShell from './AppShell';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';

export interface LegalSection {
  h: string;
  paras?: string[];
  list?: string[];
}

interface LegalDocProps {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  children?: ReactNode;
}

const OTHERS = [
  { href: '/legal/privacy', key: 'privacy' as const },
  { href: '/legal/terms', key: 'terms' as const },
  { href: '/legal/user-policy', key: 'userPolicy' as const },
  { href: '/legal/cookies', key: 'cookies' as const }
];

export default function LegalDoc({ title, updated, intro, sections, children }: LegalDocProps) {
  const { t } = useApp();
  return (
    <AppShell>
      <article className="legal-doc">
        <header className="legal-head">
          <span className="legal-mark">{IC.shield}</span>
          <h1>{title}</h1>
          <p className="legal-updated">{t('lastUpdated')}: {updated}</p>
          <p className="legal-intro">{intro}</p>
        </header>

        <nav className="legal-toc" aria-label={title}>
          {sections.map((s, i) => <a key={s.h} href={`#s${i + 1}`}>{i + 1}. {s.h}</a>)}
        </nav>

        {sections.map((s, i) => (
          <section className="legal-section" id={`s${i + 1}`} key={s.h}>
            <h2><span className="legal-num">{i + 1}</span>{s.h}</h2>
            {s.paras?.map(p => <p key={p.slice(0, 40)}>{p}</p>)}
            {s.list && <ul>{s.list.map(item => <li key={item.slice(0, 40)}>{item}</li>)}</ul>}
          </section>
        ))}

        {children}

        <footer className="legal-foot">
          <b>Exposing</b>
          <nav aria-label="Policies">
            {OTHERS.map(o => <Link key={o.href} href={o.href}>{t(o.key)}</Link>)}
          </nav>
          <p>© 2026 Exposing · NepTech Solutions. {t('rights')}</p>
        </footer>
      </article>
    </AppShell>
  );
}