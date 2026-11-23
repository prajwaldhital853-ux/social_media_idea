'use client';

import Link from 'next/link';
import { useApp } from '@/lib/AppContext';

export default function SiteFooter() {
  const { t, db } = useApp();
  // The desk's line when a seat has written one, the platform's own otherwise.
  const tagline = (db.settings.wording?.tagline || '').trim() || t('tagline');
  return (
    <footer className="site-footer">
      <nav className="footer-links" aria-label="Legal">
        <Link href="/legal/privacy">{t('privacy')}</Link>
        <Link href="/legal/terms">{t('terms')}</Link>
        <Link href="/legal/user-policy">{t('userPolicy')}</Link>
        <Link href="/legal/cookies">{t('cookies')}</Link>
      </nav>
      {tagline && <p className="footer-tagline">{tagline}</p>}
      <p className="footer-copy">© 2026 Exposing. {t('rights')}</p>
    </footer>
  );
}