'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { StatusChip } from '@/components/WalletShell';
import { useApp } from '@/lib/AppContext';
import { coinRequestsFragment, useList, walletFragment } from '@/lib/lists';
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

function useRequestRows() {
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
 * Both halves page: the preview is a section of a scrolling page, and a reader
 * who wants the eleventh movement should be able to reach it without leaving.
 */
export function LedgerRows({ cap, href }: { cap?: number; href?: string }) {
  const { db, t, serverMode } = useApp();
  const { rows, list } = useLedgerRows();
  const page = cap || WINDOW;
  const windowed = useWindowed(rows.length, page, db.lang === 'ne' ? 'ne' : 'en',
    serverMode ? { hasMore: list.hasMore, loading: list.loading, load: list.loadMore } : undefined,
    PAGED_WINDOW);
  const shown = rows.slice(0, windowed.limit);

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
        <WalletSeam windowed={windowed} />
      </div>
      {cap && href && rows.length > cap && (
        <Link className="wallet-more" href={href}>{t('viewAll')} · {rows.length}</Link>
      )}
    </>
  );
}

export function RequestRows({ cap, href }: { cap?: number; href?: string }) {
  const { db, t, serverMode } = useApp();
  const { rows, list } = useRequestRows();
  const page = cap || WINDOW;
  const windowed = useWindowed(rows.length, page, db.lang === 'ne' ? 'ne' : 'en',
    serverMode ? { hasMore: list.hasMore, loading: list.loading, load: list.loadMore } : undefined,
    PAGED_WINDOW);
  const shown = rows.slice(0, windowed.limit);

  if (shown.length === 0) {
    return (!serverMode || list.loaded)
      ? <p className="wallet-empty">{t('noRequests')}</p>
      : <div className="wallet-rows" aria-hidden="true"><i className="wallet-skel" /><i className="wallet-skel" /></div>;
  }

  return (
    <>
      <div className="wallet-rows">
        {shown.map(r => (
          <div className="wallet-entry" key={r.id}>
            <span className="wallet-entry-day">{day(r.ts, db.lang)}</span>
            <span className="wallet-entry-main">
              <b>{r.coins} {t('coins')} · NPR {r.amount}</b>
              <small>{r.method === 'bank' ? t('bankTransfer') : t('qrPay')} · {r.reference} · {ago(r.ts, db.lang)}</small>
              {r.note && <small className="wallet-entry-note">{r.note}</small>}
            </span>
            <StatusChip status={r.status} />
            {r.resubmitted && r.status === 'pending' && <span className="wallet-status resubmitted">{t('resubmitted')}</span>}
          </div>
        ))}
        <WalletSeam windowed={windowed} />
      </div>
      {cap && href && rows.length > cap && (
        <Link className="wallet-more" href={href}>{t('viewAll')} · {rows.length}</Link>
      )}
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
