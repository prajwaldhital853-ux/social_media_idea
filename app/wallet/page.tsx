'use client';

import Link from 'next/link';
import WalletShell, { StatusChip } from '@/components/WalletShell';
import { LedgerRows, ProofAskBanner, RequestRows } from '@/components/WalletLists';
import { useApp } from '@/lib/AppContext';
import { ago } from '@/lib/utils';

export default function WalletOverviewPage() {
  const { db, me, t } = useApp();
  const price = db.settings.coinPrice;
  const promos = me ? db.promotions.filter(p => p.uid === me.id).sort((a, b) => b.ts - a.ts) : [];
  const running = promos.filter(p => p.status === 'active' || p.status === 'paused');
  const reach = promos.reduce((sum, p) => sum + p.impressions, 0);
  const spent = promos.reduce((sum, p) => sum + p.coins, 0);

  const targetTitle = (targetType: 'post' | 'listing', targetId: string) =>
    targetType === 'post'
      ? (db.posts.find(p => p.id === targetId)?.text || '').slice(0, 60) || t('unavailable')
      : db.listings.find(l => l.id === targetId)?.title || t('unavailable');

  return (
    <WalletShell>
      <ProofAskBanner />

      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('addCoins')}</h2>
          <span className="wallet-sec-note">{t('coinRate', { n: price })}</span>
        </div>
        <div className="wallet-choices">
          <Link href="/wallet/bank" className="wallet-choice">
            <b>{t('bankTransfer')}</b>
            <p>{t('payBankSub')}</p>
            <span className="wallet-choice-go">{t('addCoins')} →</span>
          </Link>
          <Link href="/wallet/qr" className="wallet-choice">
            <b>{t('qrPay')}</b>
            <p>{t('payQrSub')}</p>
            <span className="wallet-choice-go">{t('addCoins')} →</span>
          </Link>
        </div>
      </section>

      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('myPromotions')}</h2>
          <Link href="/wallet/promotions" className="wallet-sec-note">{t('viewAll')}</Link>
        </div>
        <div className="wallet-figures">
          <div><b>{running.length}</b><span>{t('active')}</span></div>
          <div><b>{reach.toLocaleString('en-US')}</b><span>{t('impressions')}</span></div>
          <div><b>{spent}</b><span>{t('spent')}</span></div>
        </div>
        {promos.length === 0 ? (
          <p className="wallet-empty">{t('noPromos')}</p>
        ) : (
          <div className="wallet-rows">
            {promos.slice(0, 3).map(p => (
              <div className="wallet-entry" key={p.id}>
                <span className="wallet-entry-main">
                  <b>{targetTitle(p.targetType, p.targetId)}</b>
                  <small>{ago(p.ts, db.lang)} · {t('clicks')} {p.clicks}</small>
                </span>
                <StatusChip status={p.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('pendingRequests')}</h2>
          <Link href="/wallet/requests" className="wallet-sec-note">{t('viewAll')}</Link>
        </div>
        <RequestRows cap={4} href="/wallet/requests" />
      </section>

      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('ledger')}</h2>
          <Link href="/wallet/history" className="wallet-sec-note">{t('viewAll')}</Link>
        </div>
        <LedgerRows cap={6} href="/wallet/history" />
      </section>
    </WalletShell>
  );
}
