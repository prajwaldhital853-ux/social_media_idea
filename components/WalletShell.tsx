'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApp } from '@/lib/AppContext';

export const WALLET_TABS = [
  { href: '/wallet', key: 'overview' },
  { href: '/wallet/history', key: 'history' },
  { href: '/wallet/requests', key: 'requests' },
  { href: '/wallet/bank', key: 'bankTransfer' },
  { href: '/wallet/qr', key: 'qrPay' },
  { href: '/wallet/promotions', key: 'promotions' },
] as const;

export function StatusChip({ status }: { status: string }) {
  const { t } = useApp();
  const label = status === 'pending' || status === 'draft'
    ? t('pending')
    : status === 'approved' || status === 'active'
      ? t('approved')
      : status === 'rejected'
        ? t('rejected')
        : status === 'refunded'
          ? t('refunded')
          : status === 'refund_refused'
            ? t('refundRefused')
            : status === 'ended'
              ? t('ended')
              : status === 'paused'
                ? t('paused')
                : status;
  return <span className={`wallet-status ${status}`}>{label}</span>;
}

/**
 * One frame for every wallet screen: the balance is always in sight, and the
 * six sections are one tap apart. Nothing here scrolls horizontally and no
 * screen asks the page behind it to move.
 */
export default function WalletShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { db, me, t, ready } = useApp();
  const price = db.settings.coinPrice;

  if (!me) {
    return (
      <AppShell>
        <header className="wallet-top">
          <div className="wallet-top-row">
            <h1 className="wallet-h1">{t('wallet')}</h1>
          </div>
        </header>
        <div className="wallet-note">
          {ready && <><p>{t('needLogin')}</p><Link href="/login">{t('signIn')}</Link></>}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="wallet-top">
        <div className="wallet-top-row">
          <div>
            <h1 className="wallet-h1">{t('wallet')}</h1>
            <p className="wallet-sub">{t('walletSub')}</p>
          </div>
          <div className="wallet-top-right">
            <div className="wallet-balance">
              <span className="wallet-balance-label">{t('balance')}</span>
              <b className="wallet-balance-num">{me.coins}</b>
              <span className="wallet-balance-npr">≈ NPR {(me.coins * price).toLocaleString('en-US')}</span>
            </div>
          </div>
        </div>
        <nav className="wallet-tabs" aria-label={t('wallet')}>
          {WALLET_TABS.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`wallet-tab ${pathname === tab.href ? 'on' : ''}`}
            >
              {t(tab.key)}
            </Link>
          ))}
        </nav>
      </header>
      <div className="wallet-body">{children}</div>
    </AppShell>
  );
}
