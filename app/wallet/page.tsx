'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import WalletShell, { StatusChip } from '@/components/WalletShell';
import { LedgerRows, ProofAskBanner, RequestRows } from '@/components/WalletLists';
import { useApp } from '@/lib/AppContext';
import { promotionsFragment, useList } from '@/lib/lists';
import { ago } from '@/lib/utils';
import { Promotion } from '@/lib/types';

// Every list on this page is a summary of a page that holds the whole thing, so
// each one stops at the newest five and leaves "view all" as the only way onward.
const PREVIEW = 5;

export default function WalletOverviewPage() {
  const { db, me, t, serverMode } = useApp();
  const price = db.settings.coinPrice;

  // The rows are read through the campaign list so the overview answers for orders
  // placed, decided and served while the page sat open. It shows five of them: the
  // list is what stays current, the cap is only how much of it the summary prints.
  const list = useList(
    'promotions',
    { path: '/promotions/', frag: promotionsFragment },
    undefined,
    serverMode && !!me,
  );
  const mine = useMemo<Promotion[]>(() => {
    if (!me) return [];
    if (serverMode) {
      const index = new Map(db.promotions.map(p => [p.id, p] as [string, Promotion]));
      return list.ids.map(id => index.get(id)).filter((p): p is Promotion => !!p && p.uid === me.id);
    }
    return db.promotions.filter(p => p.uid === me.id).sort((a, b) => b.ts - a.ts);
  }, [db.promotions, list.ids, me, serverMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const promos = mine.slice(0, PREVIEW);

  // The four figures answer for every campaign this client knows, not the ten
  // rows on screen: a total that moved with the scroll would sit a different
  // number over the list it came from.
  const known = me ? db.promotions.filter(p => p.uid === me.id) : [];
  const running = known.filter(p => p.status === 'active' || p.status === 'paused');
  const reach = known.reduce((sum, p) => sum + p.impressions, 0);
  const spent = known.reduce((sum, p) => sum + p.coins, 0);
  const answered = known.reduce((sum, p) => sum + (p.messages || 0), 0);

  // The caption usually rides the post rows, which this screen never asks for; the
  // server's own line for the advertised target is what stops a live campaign from
  // being introduced as something that is not available.
  const targetTitle = (targetType: 'post' | 'listing', targetId: string, label?: string) =>
    targetType === 'post'
      ? (db.posts.find(p => p.id === targetId)?.text || label || '').slice(0, 60) || t('unavailable')
      : db.listings.find(l => l.id === targetId)?.title || label || t('unavailable');

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
          <div><b>{answered.toLocaleString('en-US')}</b><span title={t('conversionHint')}>{t('promoMessages')}</span></div>
        </div>
        {mine.length === 0 ? (serverMode && !list.loaded ? (
          <div className="wallet-rows" aria-hidden="true">
            <i className="wallet-skel" /><i className="wallet-skel" />
          </div>
        ) : (
          <p className="wallet-empty">{t('noPromos')}</p>
        )) : (
          <div className="wallet-rows">
            {promos.map(p => (
              <div className="wallet-entry" key={p.id}>
                <span className="wallet-entry-main">
                  <b>{targetTitle(p.targetType, p.targetId, p.targetLabel)}</b>
                  <small>
                    {ago(p.ts, db.lang)} · {t('clicks')} {p.clicks} · {t('promoMessages')} {(p.messages || 0).toLocaleString('en-US')}
                  </small>
                </span>
                <StatusChip status={p.status} />
              </div>
            ))}
          </div>
        )}
        {mine.length > PREVIEW && (
          <Link className="wallet-more" href="/wallet/promotions">{t('viewAll')} · {known.length}</Link>
        )}
      </section>

      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('pendingRequests')}</h2>
          <Link href="/wallet/requests" className="wallet-sec-note">{t('viewAll')}</Link>
        </div>
        <RequestRows cap={PREVIEW} href="/wallet/requests" fixed />
      </section>

      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('ledger')}</h2>
          <Link href="/wallet/history" className="wallet-sec-note">{t('viewAll')}</Link>
        </div>
        <LedgerRows cap={PREVIEW} href="/wallet/history" fixed />
      </section>
    </WalletShell>
  );
}
