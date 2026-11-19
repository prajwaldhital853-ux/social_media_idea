'use client';

import Link from 'next/link';
import { useApp } from '@/lib/AppContext';

export default function SiteFooter() {
  const { t } = useApp();
  return (
    <footer className="site-footer">
      <nav className="footer-links" aria-label="Legal">
        <Link href="/legal/privacy">{t('privacy')}</Link>
        <Link href="/legal/terms">{t('terms')}</Link>
        <Link href="/legal/user-policy">{t('userPolicy')}</Link>
        <Link href="/legal/cookies">{t('cookies')}</Link>
      </nav>
      <p className="footer-copy">© 2026 Exposing. {t('rights')}</p>
    </footer>
  );
}