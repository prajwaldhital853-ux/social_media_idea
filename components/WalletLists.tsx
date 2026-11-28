'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import RefundForm from '@/components/RefundForm';
import { StatusChip } from '@/components/WalletShell';
import { useApp } from '@/lib/AppContext';
import { coinRequestsFragment, refreshList, useList, walletFragment } from '@/lib/lists';
import { PAGED_WINDOW, useWindowed } from '@/lib/useWindowed';
import { ago } from '@/lib/utils';
import { CoinRequest, LedgerEntry } from '@/lib/types';

function useLedgerRows() {
  const { db, me, serverMode } = useApp();
  const meId = me?.id || '';
  const list = useList(
    'wallet-ledger',
    { path: '/wallet/', frag: walletFragment(meId) },
    undefined,
    serverMode && !!me,
  );
  return useMemo<{ rows: LedgerEntry[]; list: typeof list }>(() => {
    if (serverMode) {
      const index = new Map(db.ledger.map(l => [l.id, l] as [string, LedgerEntry]));
      return { rows: list.ids.map(id => index.get(id)).filter((l): l is LedgerEntry => !!l), list };
    }
    return { rows: me ? db.ledger.filter(l => l.uid === me.id).sort((a, b) => b.ts - a.ts) : [], list };
  }, [db.ledger, list.ids, me, serverMode]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useRequestRows() {
  const { db, me, serverMode } = useApp();
  const list = useList(
    'coin-requests',
    { path: '/wallet/requests/list/', frag: coinRequestsFragment },
    undefined,
    serverMode && !!me,
  );
  return useMemo<{ rows: CoinRequest[]; list: typeof list }>(() => {
    if (serverMode) {
      const index = new Map(db.coinRequests.map(r => [r.id, r] as [string, CoinRequest]));
      return { rows: list.ids.map(id => index.get(id)).filter((r): r is CoinRequest => !!r), list };
    }
    return { rows: me ? db.coinRequests.filter(r => r.uid === me.id).sort((a, b) => b.ts - a.ts) : [], list };
  }, [db.coinRequests, list.ids, me, serverMode]); // eslint-disable-line react-hooks/exhaustive-deps
}

const day = (ts: number, lang: string) =>
  new Date(ts).toLocaleDateString(lang === 'ne' ? 'ne-NP' : 'en-GB', { day: '2-digit', month: 'short' });

// Ten money rows at a time, which is what every other list in the app asks the
// server for, so a page of the ledger is one round trip and one screen step.
const WINDOW = 10;

/**
 * The seam at the foot of a wallet list: the skeleton while the next ten are on
 * their way, and the marker that asks for them.
 */
function WalletSeam({ windowed }: { windowed: ReturnType<typeof useWindowed> }) {
  return (
    <>
      {windowed.pending && windowed.hasMore && [0, 1].map(i => <i className="wallet-skel" key={`sk-${i}`} aria-hidden="true" />)}
      {windowed.hasMore && <div ref={windowed.sentinel} className="feed-sentinel" aria-hidden="true" />}
    </>
  );
}

/**
 * Coin movements. A cap turns the same rows into the overview preview, which is
 * why the "view all" link lives here too — the list and its exit stay together.
 * `fixed` holds that preview to the newest few with "view all" as the only way
 * on, because a summary section is not a second list to scroll through; left off,
 * the same rows page on scroll for the page that carries all of them.
 */
export function LedgerRows({ cap, href, fixed }: { cap?: number; href?: string; fixed?: boolean }) {
  const { db, t, serverMode } = useApp();
  const { rows, list } = useLedgerRows();
  const page = cap || WINDOW;
  const windowed = useWindowed(rows.length, page, db.lang === 'ne' ? 'ne' : 'en',
    serverMode ? { hasMore: list.hasMore, loading: list.loading, load: list.loadMore } : undefined,
    PAGED_WINDOW);
  const shown = fixed && cap ? rows.slice(0, cap) : rows.slice(0, windowed.limit);

  if (shown.length === 0) {
    return (!serverMode || list.loaded)
      ? <p className="wallet-empty">{t('noLedger')}</p>
      : <div className="wallet-rows" aria-hidden="true"><i className="wallet-skel" /><i className="wallet-skel" /></div>;
  }

  return (
    <>
      <div className="wallet-rows">
        {shown.map(l => (
          <div className="wallet-entry" key={l.id}>
            <span className="wallet-entry-day">{day(l.ts, db.lang)}</span>
            <span className="wallet-entry-main">
              <b>{l.note}</b>
              <small>{l.kind}</small>
            </span>
            <b className={`wallet-entry-num ${l.delta >= 0 ? 'in' : 'out'}`}>
              {l.delta >= 0 ? '+' : '−'}{Math.abs(l.delta)}
            </b>
          </div>
        ))}
        {!fixed && <WalletSeam windowed={windowed} />}
      </div>
      {cap && href && rows.length > cap && (
        <Link className="wallet-more" href={href}>{t('viewAll')} · {rows.length}</Link>
      )}
    </>
  );
}

/**
 * Coin purchases. A cap turns the same rows into the overview preview, and `fixed`
 * holds that preview to the newest few with "view all" as the only way on: a
 * summary section is not a second list to scroll through.
 */
export function RequestRows({ cap, href, fixed }: { cap?: number; href?: string; fixed?: boolean }) {
  const { db, t, serverMode, showToast } = useApp();
  const { rows, list } = useRequestRows();
  const [refund, setRefund] = useState<CoinRequest | null>(null);
  // A decision the desk makes while this page is open should turn the badge over on
  // its own. The bell stream is the fast path, but a worker that buffers it away must
  // not also cost the member the answer, so while a row still waits on the desk the
  // list is quietly re-read from a visible tab.
  const waitingOnDesk = rows.some(r => r.status === 'pending'
    || (!!r.refundRequested && !r.refunded && !r.refundRefused));
  useEffect(() => {
    if (!serverMode || !waitingOnDesk) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refreshList('coin-requests', { path: '/wallet/requests/list/', frag: coinRequestsFragment });
    }, 7000);
    return () => clearInterval(timer);
  }, [serverMode, waitingOnDesk]);
  const page = cap || WINDOW;
  const windowed = useWindowed(rows.length, page, db.lang === 'ne' ? 'ne' : 'en',
    serverMode ? { hasMore: list.hasMore, loading: list.loading, load: list.loadMore } : undefined,
    PAGED_WINDOW);
  const shown = fixed && cap ? rows.slice(0, cap) : rows.slice(0, windowed.limit);
  // One ask is the whole queue. The server says so row by row, and a demo build has
  // no server, so the rows on screen answer for themselves.
  const queueOpen = rows.some(x => !!x.refundRequested && !x.refunded && !x.refundRefused);

  if (shown.length === 0) {
    return (!serverMode || list.loaded)
      ? <p className="wallet-empty">{t('noRequests')}</p>
      : <div className="wallet-rows" aria-hidden="true"><i className="wallet-skel" /><i className="wallet-skel" /></div>;
  }

  return (
    <>
      <div className="wallet-rows">
        {shown.map(r => {
          // The desk answers this question, because only it knows whether a coin of
          // that batch was spent. A demo build has no lots, so an approved purchase
          // is refundable until an ask is filed or one is turned down.
          const settled = !!r.refunded || !!r.refundRefused;
          const askable = (r.refundable ?? (r.status === 'approved' && !r.refundRequested && !settled))
            && !queueOpen;
          // The desk answers whether an ask fits those coins, but a member who cannot
          // see the door has no way to learn the rule exists. So the button stays on
          // every approved purchase and names the reason when it is turned away.
          const closable = r.status === 'approved' && !r.refundRequested && !settled;
          const shut = r.refundPromoPending ? t('refundPromoPending')
            : (r.refundOtherOpen ?? queueOpen) ? t('refundOneAtATime')
            : r.refundSpent ? t('refundSpent') : t('refundClosed');
          // An ask the desk has not answered is said twice: as the chip beside the
          // purchase it holds, and as the money it froze written out under it.
          const owed = !!r.refundRequested && !settled;
          return (
            <div className="wallet-entry" key={r.id}>
              <span className="wallet-entry-day">{day(r.ts, db.lang)}</span>
              <span className="wallet-entry-main">
                <b>{r.coins} {t('coins')} · NPR {r.amount}</b>
                <small>{r.method === 'bank' ? t('bankTransfer') : t('qrPay')} · {r.reference} · {ago(r.ts, db.lang)}</small>
                {r.note && <small className="wallet-entry-note">{r.note}</small>}
                {r.status === 'pending' && <small className="wallet-entry-remind">{t('coinOneAtATime')}</small>}
                {r.status === 'pending' && <small className="wallet-entry-hint">{t('refundNotice')}</small>}
                {owed && !!r.locked && (
                  <small className="wallet-entry-lock">{t('refundLocked', { n: r.locked })}</small>
                )}
                {r.refundSpent && <small className="wallet-entry-shut">{t('refundSpent')}</small>}
                {r.refundPromoPending && <small className="wallet-entry-shut">{t('refundPromoPending')}</small>}
                {askable && <small className="wallet-entry-warn">{t('refundSpent')}</small>}
                {r.refundRefused && (
                  <small className="wallet-entry-shut">{t('refundRefusedNote')}</small>
                )}
              </span>
              <span className="wallet-entry-side">
                <StatusChip status={r.refundRefused && r.status === 'approved' ? 'refund_refused' : r.status} />
                {owed && <span className="wallet-status refund_requested">{t('refundRequestedBadge')}</span>}
                {r.resubmitted && r.status === 'pending' && <span className="wallet-status resubmitted">{t('resubmitted')}</span>}
                {closable && (
                  <button
                    type="button"
                    className={`refund-ask ${askable ? '' : 'shut'}`}
                    onClick={() => { if (askable) setRefund(r); else showToast(shut); }}
                  >
                    {t('refundRequest')}
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {!fixed && <WalletSeam windowed={windowed} />}
      </div>
      {cap && href && rows.length > cap && (
        <Link className="wallet-more" href={href}>{t('viewAll')} · {rows.length}</Link>
      )}
      {refund && <RefundForm request={refund} onClose={() => setRefund(null)} />}
    </>
  );
}

/**
 * The sentence the wallet has to say before anything else: the desk looked at a
 * payment and could not credit it. The server decides whether an ask is still
 * outstanding, so answering one closes this and a second ask re-opens it.
 */
export function ProofAskBanner() {
  const { t } = useApp();
  const { rows } = useRequestRows();
  const open = rows.filter(r => r.proofAsked).sort((a, b) => b.ts - a.ts)[0];
  if (!open) return null;
  return (
    <div className="notice-banner" role="status">
      <div className="notice-line">
        <p className="notice-copy">
          <span className="notice-text">{t('proofNeeded')}</span>
          {open.proofReason && <span className="notice-reason">{open.proofReason}</span>}
        </p>
        <Link href={`/wallet/proof/${open.id}`}>{t('uploadProof')}</Link>
      </div>
    </div>
  );
}
