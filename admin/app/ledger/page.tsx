'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Banner from '@/components/Banner';
import { useConfirm } from '@/components/Confirm';
import ConsoleShell from '@/components/ConsoleShell';
import { Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { LedgerPage, LedgerRow } from '@/lib/types';

/**
 * Contract 6.7 — the ledger. Every wallet has a `balance` column, but this screen
 * reads the rows behind it, because a balance is an opinion and a ledger is a
 * record. Nothing here edits or removes a row: the only thing a seat can do is add
 * one, and an added row has to say why in words that stay with it forever.
 */

const MOVES = [
  { id: 'all', label: 'Every movement' },
  { id: 'credit', label: 'Coins in' },
  { id: 'debit', label: 'Coins out' },
];

export default function LedgerScreen() {
  const { noteGate } = useSession();
  const [page, setPage] = useState<LedgerPage | null>(null);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const seq = useRef(0);

  const fetchPage = useCallback((after: string | null) => {
    const params = new URLSearchParams();
    if (kind !== 'all') params.set('kind', kind);
    if (q.trim()) params.set('q', q.trim());
    if (after) params.set('cursor', after);
    return api<LedgerPage>(`admin/coins/ledger/?${params}`);
  }, [kind, q]);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const next = await fetchPage(null);
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
      title="Coin ledger"
      subtitle="Every movement of coins that ever happened, in the wallet’s own append-only table — with one door that adds a row and no door that changes one."
      actions={(
        <>
          <button
            type="button" className="btn ghost" data-adjust-open
            onClick={() => setWriting(v => !v)}
            title={writing ? 'Put the pen down' : 'Write a ledger row by hand'}
          >
            {IC.pen}<span>{writing ? 'Cancel' : 'Write a ledger row'}</span>
          </button>
          <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the ledger">
            {IC.refresh}<span>Refresh</span>
          </button>
        </>
      )}
    >
      {writing && <Adjust onWritten={entry => {
        setRows(list => [entry, ...(list || [])]);
        setWriting(false);
        setBanner({ kind: 'ok', text: entry.written });
      }} noteGate={noteGate}/>}

      <Chips
        label="Filter by which way the coins moved"
        chips={MOVES.map(item => ({
          id: item.id,
          label: item.label,
          n: page ? (item.id === 'all'
            ? page.totals.entries
            : page.counts?.[item.id as 'credit' | 'debit']) : undefined,
        }))}
        value={kind}
        onPick={setKind}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search by account" aria-label="Search the ledger"
          />
        </label>
        <span className="toolbar-count">
          {rows === null ? '…' : <>Rows on screen: <b>{rows.length}</b></>}
        </span>
      </div>

      <Banner banner={banner} />

      {page && (
        <p className="facets" data-totals>
          <b>{num(Number(page.totals.credited))}</b> coins in
          <span className="dot"/>
          <b>{num(Number(page.totals.debited))}</b> out
          <span className="dot"/>
          <span>{num(page.totals.entries)} rows written since the table began — none of them editable</span>
        </p>
      )}

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : rows.length === 0 ? (
        <section className="panel empty">
          <h2>No movements to read</h2>
          <p>
            Nothing has moved through a wallet yet, or nothing matches this search. A purchase,
            a boost and a hand-written correction each write a row here the moment they happen.
          </p>
        </section>
      ) : (
        <div className="ledger grid-wrap">
          <table className="grid review" data-list="ledger">
            <thead>
              <tr>
                <th style={{ width: '20%' }}>Whose wallet</th>
                <th style={{ width: '14%' }}>Movement</th>
                <th style={{ width: '38%' }}>The note on the row</th>
                <th style={{ width: '14%' }}>Written</th>
                <th style={{ width: '14%' }}>Wallet now</th>
              </tr>
            </thead>
            {rows.map(row => <Entry key={row.id} row={row}/>)}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older rows"/>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <p className="note">
          The last column is what each wallet holds <b>now</b>, not what it held the moment that row
          was written. The table stores movements and the reasons beside them; the running total is
          the wallet’s own number, and this screen never rewrites it.
        </p>
      )}
    </ConsoleShell>
  );
}

function Entry({ row }: { row: LedgerRow }) {
  const in_ = row.kind === 'credit';
  return (
    <tbody className="entry" data-entry={row.id}>
      <tr className="grid-row">
        <td data-label="Whose wallet">
          <span className="entry-who">
            <b>{row.card.name}</b>
            <em>@{row.card.username}{row.card.verified ? ' ✓' : ''}</em>
          </span>
        </td>
        <td data-label="Movement">
          <span className={`state ${in_ ? 'good' : 'dead'}`} data-move={row.kind}>
            {in_ ? '+' : '−'}{row.amount}
          </span>
        </td>
        <td data-label="The note on the row">
          <span className="entry-note" title={row.note}>{row.note || 'no note'}</span>
        </td>
        <td data-label="Written" className="dim" title={stamp(row.created_at)}>{ago(row.created_at)}</td>
        <td data-label="Wallet now" className="num strong" title={`The wallet’s own number as this screen reads it: ${row.currency}`}>
          {row.balance}
        </td>
      </tr>
    </tbody>
  );
}

/**
 * The one write this screen has. The reason box is the gate: without it the
 * server refuses the row, and a signed number with no sentence behind it is
 * exactly the thing an audit is meant to catch.
 */
function Adjust({ onWritten, noteGate }: {
  onWritten: (entry: LedgerRow & { written: string }) => void;
  noteGate: (err: unknown) => boolean;
}) {
  const [username, setUsername] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const move = async () => {
    const sure = await confirm({
      title: `${direction === 'credit' ? 'Credit' : 'Take'} ${amount.trim()} coins ${direction === 'credit' ? 'to' : 'from'} @${username.trim()}?`,
      body: 'This writes a row into their wallet by hand. It is not an edit of anything that already happened, it cannot be deleted, and the only way back is another row in the other direction. The reason goes on the audit with your name on it.',
      confirmLabel: direction === 'credit' ? 'Write the credit' : 'Write the debit',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ detail: string; entry: LedgerRow }>('admin/coins/ledger/adjust/', {
        method: 'POST', body: { username: username.trim(), direction, amount: amount.trim(), reason: reason.trim() },
      });
      onWritten({ ...out.entry, written: out.detail });
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel adjust" data-adjust>
      <div className="panel-head">
        <div>
          <h2>A row written by hand</h2>
          <p>
            For the payment the bank confirms after the request was closed, the duplicate that has
            to come back out, the goodwill credit. This does not change a balance — it adds a row,
            and the wallet’s number is the sum of the rows.
          </p>
        </div>
      </div>

      <div className="adjust-grid">
        <label className="field">
          <span>Account</span>
          <input
            value={username} onChange={event => setUsername(event.target.value)}
            placeholder="username" autoComplete="off" name="username"
          />
        </label>
        <div className="field">
          <span>Which way</span>
          <div className="moves" role="group" aria-label="Which way the coins move">
            {(['credit', 'debit'] as const).map(which => (
              <button
                key={which} type="button" data-move-pick={which}
                className={`fchip${direction === which ? ' on' : ''}`}
                aria-pressed={direction === which}
                onClick={() => setDirection(which)}
              >
                {which === 'credit' ? 'Coins in' : 'Coins out'}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Coins</span>
          <input
            value={amount} inputMode="decimal" name="amount" autoComplete="off"
            onChange={event => setAmount(event.target.value)} placeholder="0"
          />
        </label>
      </div>

      <label className="field">
        <span>Why — it is printed on the row and stays there forever</span>
        <textarea
          rows={2} name="reason" maxLength={180} value={reason} autoFocus
          placeholder="e.g. the bank confirmed a second payment for request #41"
          onChange={event => setReason(event.target.value)}
        />
      </label>

      <div className="ask-actions">
        <button
          type="button" className="btn primary" data-adjust-save
          disabled={busy || !reason.trim() || !username.trim() || !amount.trim()}
          onClick={move}
          title={reason.trim() ? 'Write the row' : 'The row needs a reason before it can be written'}
        >
          {IC.go}<span>{busy ? 'Writing…' : 'Write the row'}</span>
        </button>
      </div>

      {error && <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>}
    </section>
  );
}
