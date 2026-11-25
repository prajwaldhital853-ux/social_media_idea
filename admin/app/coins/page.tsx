'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { ActLink, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { CoinAsk, CoinPage } from '@/lib/types';

/**
 * Contract 6.7, the coin desk. Somebody has already sent real rupees and is
 * waiting on a person here, so the screen leads with what is held up and by how
 * long, and every verb that moves money names the amount it moves.
 */

const STATES = [
  { id: 'pending', label: 'Waiting' },
  { id: 'approved', label: 'Credited' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'Every request' },
];

const STANDINGS: Record<string, { tone: string; label: string }> = {
  pending: { tone: 'warn', label: 'Waiting on a person' },
  approved: { tone: 'good', label: 'Coins credited' },
  rejected: { tone: 'mute', label: 'Rejected' },
};

export default function CoinsPage() {
  const { noteGate, can } = useSession();
  const [page, setPage] = useState<CoinPage | null>(null);
  const [rows, setRows] = useState<CoinAsk[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('pending');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  // The retention sweep runs inside the queue read, so opening this screen is what
  // deletes the slips. React mounts a screen twice in development, which leaves the
  // deletions in the first answer and nothing in the last one; the seat is told how
  // many this visit took, which is the sentence that is actually true.
  const [swept, setSwept] = useState(0);

  const review = can('coins_review');

  const fetchPage = useCallback((after: string | null) => {
    const params = new URLSearchParams();
    params.set('status', state);
    if (q.trim()) params.set('q', q.trim());
    if (after) params.set('cursor', after);
    return api<CoinPage>(`admin/coins/?${params}`);
  }, [q, state]);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const next = await fetchPage(null);
      // Above the race guard, on purpose: whatever wins the race, these files are
      // gone from the disk, and a screen that deleted them and says nothing is the
      // screen a seat cannot trust with a retention number.
      setSwept(count => Math.max(count, next.proofs_deleted || 0));
      if (seq.current !== mine) return;
      setRows(next.results);
      setPage(next);
      setCursor(next.next_cursor);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  }, [fetchPage, noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const older = async () => {
    if (!cursor) return;
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const next = await fetchPage(cursor);
      setSwept(count => Math.max(count, next.proofs_deleted || 0));
      if (seq.current !== mine) return;
      setRows(list => [...(list || []), ...next.results]);
      setPage(next);
      setCursor(next.next_cursor);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  };

  return (
    <ConsoleShell
      title="Coin requests"
      subtitle="Money that has already reached the platform's account and is waiting for a person to credit the coins, with the payment proof beside the request, never beside the list."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the queue">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Chips
        label="Filter by where the request stands"
        chips={STATES.map(item => ({
          id: item.id,
          label: item.label,
          n: page ? (item.id === 'all' ? page.counts.every : page.counts[item.id as 'pending' | 'approved' | 'rejected']) : undefined,
        }))}
        value={state}
        onPick={setState}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search by payer or bank reference" aria-label="Search coin requests"
          />
        </label>
        <span className="toolbar-count">
          {rows === null ? '…' : <>Requests to look at: <b>{rows.length}</b></>}
        </span>
      </div>

      <Banner banner={banner} />

      {page && (
        <p className="facets" data-held>
          <span><b>{num(page.held.coins)}</b> coins</span>
          <span className="dot"/>
          <span>NPR {page.held.rupees} held up behind the review</span>
          <span className="dot"/>
          <span>a payment proof is kept for {page.retention_days} days</span>
          {swept > 0 && (
            <>
              <span className="dot"/>
              <span data-swept>{swept} proof(s) just deleted by that window</span>
            </>
          )}
        </p>
      )}

      {!review && can('coins_view') && (
        <p className="note row">
          {IC.lock}
          <span>
            Your seat reads the queue and opens a proof, but crediting coins needs
            <b> Approve, reject or question requests</b>, which is not on it.
          </span>
        </p>
      )}

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : rows.length === 0 ? (
        <section className="panel empty">
          <h2>Nothing to settle</h2>
          <p>
            {state === 'pending'
              ? 'Every coin purchase that reached the account has been credited. A new one appears the moment someone uploads their receipt.'
              : 'No request matches this view. Try widening the filter.'}
          </p>
        </section>
      ) : (
        <div className="coins grid-wrap">
          <table className="grid review">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Who paid</th>
                <th style={{ width: '9%' }}>Coins</th>
                <th style={{ width: '11%' }}>Rupees sent</th>
                <th style={{ width: '18%' }}>Bank reference</th>
                <th style={{ width: '12%' }}>Waiting</th>
                <th style={{ width: '14%' }}>Standing</th>
                <th style={{ width: '14%' }}>Decided by</th>
                <th style={{ width: '6%' }} aria-label="Actions"/>
              </tr>
            </thead>
            {rows.map(row => <Ask key={row.id} row={row}/>)}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older requests"/>
        </div>
      )}
    </ConsoleShell>
  );
}


/**
 * The row is the queue; the desk is a page. A request that moves real money
 * is not settled inside a table a scroll can carry away.
 */
function Ask({ row }: { row: CoinAsk }) {
  const standing = STANDINGS[row.status] || { tone: 'mute', label: row.status_label };

  return (
    <tbody className="coin" data-coin={row.id}>
      <tr className="grid-row">
        <td data-label="Who paid">
          <Link href={`/coins/${row.id}`} className="coin-id">
            <span className="grid-caret">{IC.chevron}</span>
            <span className="coin-name">
              <b>{row.card.name}</b>
              <em>@{row.card.username}{row.card.verified ? ' ✓' : ''}</em>
            </span>
          </Link>
        </td>
        <td data-label="Coins" className="strong num" data-coins>{row.coins}</td>
        <td data-label="Rupees sent" className="num">NPR {row.amount}</td>
        <td data-label="Bank reference">
          <span className="coin-ref" title={row.reference}>{row.reference || 'no reference given'}</span>
          <p className="coin-way">{row.method === 'bank' ? 'Bank transfer' : row.method.toUpperCase()}</p>
        </td>
        <td data-label="Waiting" className="dim">
          <span className={`pile${row.status === 'pending' ? ' open' : ' shut'}`} title={stamp(row.created_at)}>
            {IC.coin}<b>{Math.round(row.age_hours)} h</b>
          </span>
        </td>
        <td data-label="Standing">
          <span className={`pill ${standing.tone}`}>{standing.label}</span>
          {row.status === 'pending' && (row.asked
            ? <span className="pill dead" data-owed>Owed proof</span>
            : row.resubmitted && <span className="pill good" data-resent>Proof resent</span>)}
        </td>
        <td data-label="Decided by" className="dim">
          {row.review
            ? <span className="coin-by">{row.review.label} by <b>{row.review.by || 'the system'}</b> {ago(row.review.at)}</span>
            : <span className="coin-by dim">nobody yet</span>}
        </td>
        <td data-label="Actions">
          <div className="grid-acts">
            <ActLink to={`/coins/${row.id}`} icon="eye" label="Open this request"/>
          </div>
        </td>
      </tr>
    </tbody>
  );
}
