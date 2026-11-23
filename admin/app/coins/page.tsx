'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { Act, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { CoinAsk, CoinDetail, CoinPage, LedgerPage, ProofLink } from '@/lib/types';

/**
 * Contract 6.7 — the coin desk. Somebody has already sent real rupees and is
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

  const settle = async (id: number, verb: string, reason: string) => {
    const out = await api<{ detail: string; request: CoinAsk }>(`admin/coins/${id}/${verb}/`, {
      method: 'POST', body: { reason },
    });
    setRows(list => (list || []).map(row => (row.id === id ? out.request : row)));
    setPage(current => (current ? {
      ...current,
      counts: {
        ...current.counts,
        pending: current.counts.pending + (out.request.status === 'pending' ? 0 : -1),
        approved: current.counts.approved + (out.request.status === 'approved' ? 1 : 0),
        rejected: current.counts.rejected + (out.request.status === 'rejected' ? 1 : 0),
      },
    } : current));
    setBanner({ kind: 'ok', text: out.detail });
    return out;
  };

  return (
    <ConsoleShell
      title="Coin requests"
      subtitle="Money that has already reached the platform's account and is waiting for a person to credit the coins — with the payment proof beside the request, never beside the list."
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
            {rows.map(row => (
              <Ask
                key={row.id} row={row} canReview={review} busy={busy}
                settle={settle} onReask={load}
              />
            ))}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older requests"/>
        </div>
      )}
    </ConsoleShell>
  );
}

function Ask({ row, canReview, busy, settle, onReask }: {
  row: CoinAsk;
  canReview: boolean;
  busy: boolean;
  settle: (id: number, verb: string, reason: string) => Promise<unknown>;
  onReask: () => Promise<void>;
}) {
  const { noteGate } = useSession();
  const [open, setOpen] = useState(false);
  const [verb, setVerb] = useState<'reject' | 'proof' | null>(null);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState<CoinDetail | null>(null);
  const [proof, setProof] = useState<ProofLink | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const standing = STANDINGS[row.status] || { tone: 'mute', label: row.status_label };
  const timer = useRef<number | null>(null);

  // The link is a two-minute window on purpose, so the picture closes itself when
  // the window does rather than staying on screen as if it were still private.
  useEffect(() => {
    if (!proof) return undefined;
    timer.current = window.setTimeout(() => setClosed(true), proof.expires_in * 1000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [proof]);

  useEffect(() => {
    setClosed(false);
    setProof(null);
  }, [row.id]);

  const expand = async () => {
    setOpen(true);
    if (detail) return;
    try {
      setDetail(await api<CoinDetail>(`admin/coins/${row.id}/`));
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    }
  };

  const showProof = async () => {
    setError(null);
    try {
      setClosed(false);
      setProof(await api<ProofLink>(`admin/coins/${row.id}/receipt-link/`));
    } catch (err) {
      setProof(null);
      if (!noteGate(err)) setError((err as Error).message);
    }
  };

  const submit = async (which: 'approve' | 'reject' | 'proof') => {
    setWorking(true);
    setError(null);
    try {
      await settle(row.id, which, verb === which ? reason.trim() : '');
      setVerb(null);
      setReason('');
      setDetail(await api<CoinDetail>(`admin/coins/${row.id}/`));
      onReask();
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <tbody className={`coin${open ? ' open' : ''}`} data-coin={row.id}>
      <tr className={`grid-row${open ? ' open' : ''}`}>
        <td>
          <button type="button" className="coin-id" aria-expanded={open} onClick={() => (open ? setOpen(false) : expand())}>
            <span className="grid-caret">{IC.chevron}</span>
            <span className="coin-name">
              <b>{row.card.name}</b>
              <em>@{row.card.username}{row.card.verified ? ' ✓' : ''}</em>
            </span>
          </button>
        </td>
        <td className="strong num" data-coins>{row.coins}</td>
        <td className="num">NPR {row.amount}</td>
        <td>
          <span className="coin-ref" title={row.reference}>{row.reference || 'no reference given'}</span>
          <p className="coin-way">{row.method === 'bank' ? 'Bank transfer' : row.method.toUpperCase()}</p>
        </td>
        <td className="dim">
          <span className={`pile${row.status === 'pending' ? ' open' : ' shut'}`} title={stamp(row.created_at)}>
            {IC.coin}<b>{Math.round(row.age_hours)} h</b>
          </span>
        </td>
        <td><span className={`pill ${standing.tone}`}>{standing.label}</span></td>
        <td className="dim">
          {row.review
            ? <span className="coin-by">{row.review.label} by <b>{row.review.by || 'the system'}</b> {ago(row.review.at)}</span>
            : <span className="coin-by dim">nobody yet</span>}
        </td>
        <td>
          <div className="grid-acts">
            <Act icon="eye" label={open ? 'Close this request' : 'Open this request'} onClick={() => (open ? setOpen(false) : expand())}/>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="grid-detail">
          <td colSpan={8}>
            <div className="grid-body coin-body">
              <div>
                <h3>What they say they paid</h3>
                <ul className="coin-facts">
                  <li><span>Coins asked for</span><b>{row.coins}</b></li>
                  <li><span>Rupees</span><b>{row.amount}</b></li>
                  <li><span>Method</span><b>{row.method}</b></li>
                  <li><span>Reference</span><b>{row.reference || '—'}</b></li>
                  <li><span>Uploaded</span><b>{ago(row.created_at)}</b></li>
                </ul>

                <h3>The payment proof</h3>
                {row.has_proof ? (
                  proof && !closed ? (
                    <div className="proof" data-proof>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proof.href} alt={`Payment proof for @${row.card.username}`} className="proof-img"/>
                      <p className="note row">
                        {IC.lock}
                        <span>This link closes after {Math.round(proof.expires_in / 60)} minutes and is
                          good only for your seat. The receipt is never printed in the list itself.</span>
                      </p>
                    </div>
                  ) : (
                    <div className="proof-shut">
                      <button type="button" className="btn ghost tiny" disabled={working} onClick={showProof} data-proof-open>
                        {IC.eye}<span>{closed ? 'Ask for the link again' : 'Open the payment proof'}</span>
                      </button>
                      {closed && <p className="note row"><span>That view has closed. Nothing was downloaded.</span></p>}
                    </div>
                  )
                ) : (
                  <p className="empty-note">{IC.x}<span>They have not uploaded a receipt yet.</span></p>
                )}

                {detail && detail.asks.length > 0 && (
                  <>
                    <h3>What was asked of them</h3>
                    <ul className="coin-asks">
                      {detail.asks.map((ask, index) => (
                        <li key={`${ask.at}-${index}`}>
                          <b>{ask.action === 'proof' ? 'More proof' : ask.action === 'reject' ? 'Rejected' : 'Credited'}</b>
                          <span>{ask.reason || 'no sentence was written'}</span>
                          <em>{ask.by ? `@${ask.by}` : 'system'} {ago(ask.at)}</em>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div>
                <h3>Decide</h3>
                {row.status !== 'pending' ? (
                  <div className="verdict">
                    <p className="verdict-line">
                      {IC.check}
                      <span><b>{row.review?.label || row.status_label}</b> — {row.review?.reason || 'no sentence was written'}</span>
                    </p>
                    {row.review?.coins_credited ? (
                      <p className="verdict-note">
                        <span>Coins moved</span>
                        <b>{row.review.coins_credited} into @{row.card.username}&apos;s wallet</b>
                      </p>
                    ) : null}
                    <p className="note">{IC.alert}<span>Nothing here can be undone. If the money was credited
                      by mistake, write a correction in the ledger — it will be a new row, not an edit.</span></p>
                  </div>
                ) : !canReview ? (
                  <p className="note row">
                    {IC.lock}
                    <span>Crediting coins is not on your seat. You can read the request and open the proof.</span>
                  </p>
                ) : (
                  <div className="decide">
                    <div className="verbs">
                      <button type="button" className="btn primary tiny" data-verb="approve"
                        disabled={working} onClick={() => submit('approve')}
                        title={`Credit ${row.coins} coins to @${row.card.username} now`}>
                        {IC.check}<span>Credit {row.coins} coins</span>
                      </button>
                      <button type="button" className="btn amber tiny" data-verb="proof"
                        disabled={working || verb === 'proof'} onClick={() => setVerb(verb === 'proof' ? null : 'proof')}
                        title="Leave the request open and ask them for a better receipt">
                        {IC.refresh}<span>Ask for more proof</span>
                      </button>
                      <button type="button" className="btn danger outline tiny" data-verb="reject"
                        disabled={working || verb === 'reject'} onClick={() => setVerb(verb === 'reject' ? null : 'reject')}
                        title="Refuse the request and tell them why">
                        {IC.x}<span>Reject</span>
                      </button>
                    </div>

                    {verb && (
                      <div className="ask">
                        <label className="field">
                          <span>{verb === 'reject' ? 'Why the money is not being credited — they are sent this' : 'What more you need from them'}</span>
                          <textarea
                            rows={2} name="reason" maxLength={240} value={reason} autoFocus
                            placeholder={verb === 'reject'
                              ? 'e.g. the reference does not match this amount'
                              : 'e.g. the right-hand edge of the receipt is cut off'}
                            onChange={event => setReason(event.target.value)}
                          />
                        </label>
                        <div className="ask-actions">
                          <button
                            type="button" className="btn primary tiny" disabled={working || !reason.trim()}
                            onClick={() => submit(verb)}
                          >
                            {IC.go}<span>{working ? 'Working…' : `Confirm — ${verb === 'reject' ? 'Reject' : 'Ask for more proof'}`}</span>
                          </button>
                          <button type="button" className="btn ghost tiny" disabled={working}
                            onClick={() => { setVerb(null); setReason(''); }}>
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {error && <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
