'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import Banner from '@/components/Banner';
import { useConfirm } from '@/components/Confirm';
import ConsoleShell from '@/components/ConsoleShell';
import { Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { LedgerPage, LedgerRow, SuggestRow } from '@/lib/types';

/**
 * Contract 6.7, the ledger. Every wallet has a `balance` column, but this screen
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

  const downloadRecord = async () => {
    const gone = page?.deleted;
    if (!gone) return;
    const rec = gone.record;
    const asNum = (v: string | number | null | undefined): string | number => {
      if (v === null || v === undefined || v === '') return '';
      const n = Number(v);
      return Number.isFinite(n) ? n : String(v);
    };
    const book = new ExcelJS.Workbook();
    book.creator = 'Exposing console';
    const sheet = (name: string, widths: number[]) => {
      const ws = book.addWorksheet(name);
      ws.columns = widths.map(width => ({ width }));
      return ws;
    };

    const head = sheet('Account', [24, 46]);
    head.addRow(['Deleted account money record']).font = { bold: true, size: 13 };
    head.addRow([]);
    head.addRow(['Account', rec.username]);
    head.addRow(['Email', rec.email]);
    head.addRow(['Signed in with', rec.provider]);
    head.addRow(['Joined', rec.joined]);
    head.addRow(['Balance at deletion', asNum(rec.balance_at_deletion)]);
    head.addRow(['Archived', gone.archived_at]);
    head.addRow(['Movements kept', rec.movements.length]);
    head.addRow(['Coin requests kept', rec.requests.length]);
    head.addRow(['Campaigns kept', rec.campaigns.length]);

    const movements = sheet('Movements', [9, 11, 36, 24, 15, 27]);
    movements.addRow(['Kind', 'Amount', 'Note', 'Reference', 'Staff', 'Date']).font = { bold: true };
    movements.views = [{ state: 'frozen', ySplit: 1 }];
    rec.movements.forEach(m => movements.addRow([
      m.kind, asNum(m.amount), m.note, m.ref, m.staff ?? '', m.created_at,
    ]));

    const requests = sheet('Coin requests', [6, 8, 10, 12, 24, 11, 27, 27]);
    requests.addRow(['#', 'Coins', 'Amount', 'Method', 'Reference', 'Status', 'Requested', 'Reviewed']).font = { bold: true };
    requests.views = [{ state: 'frozen', ySplit: 1 }];
    rec.requests.forEach((r, i) => requests.addRow([
      i + 1, asNum(r.coins), asNum(r.amount), r.method, r.reference, r.status, r.created_at, r.reviewed_at ?? '',
    ]));

    const requestsDecided = sheet('Request decisions', [12, 12, 15, 40, 14, 27]);
    requestsDecided.addRow(['Request #', 'Action', 'Staff', 'Reason', 'Coins credited', 'Date']).font = { bold: true };
    requestsDecided.views = [{ state: 'frozen', ySplit: 1 }];
    rec.requests.forEach((r, i) => r.reviews.forEach(rv => requestsDecided.addRow([
      i + 1, rv.action, rv.staff ?? '', rv.reason, asNum(rv.coins_credited), rv.created_at,
    ])));

    const campaigns = sheet('Campaigns', [6, 14, 10, 11, 26, 27, 27]);
    campaigns.addRow(['#', 'Package', 'Budget', 'Status', 'Target', 'Started', 'Ends']).font = { bold: true };
    campaigns.views = [{ state: 'frozen', ySplit: 1 }];
    rec.campaigns.forEach((c, i) => campaigns.addRow([
      i + 1, c.package, asNum(c.budget), c.status, c.target, c.starts_at ?? '', c.ends_at ?? '',
    ]));

    const campaignsDecided = sheet('Campaign decisions', [13, 12, 15, 40, 14, 10, 27]);
    campaignsDecided.addRow(['Campaign #', 'Action', 'Staff', 'Reason', 'Coins refunded', 'Choice', 'Date']).font = { bold: true };
    campaignsDecided.views = [{ state: 'frozen', ySplit: 1 }];
    rec.campaigns.forEach((c, i) => c.reviews.forEach(rv => campaignsDecided.addRow([
      i + 1, rv.action, rv.staff ?? '', rv.reason, asNum(rv.coins_refunded), rv.choice ?? '', rv.created_at,
    ])));

    const blob = new Blob([await book.xlsx.writeBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `money-record-${gone.username}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ConsoleShell
      title="Coin ledger"
      subtitle="Every movement of coins that ever happened, in the wallet’s own append-only table, with one door that adds a row and no door that changes one."
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

      {page?.deleted && (
        <section className="panel archived" data-deleted-record>
          <div className="panel-head">
            <div>
              <h2>@{page.deleted.username}'s account was deleted</h2>
              <p>
                The account and its wallet are gone; the money record is kept.{' '}
                {num(page.deleted.counts.movements)} movement(s), {num(page.deleted.counts.requests)} coin
                request(s) and {num(page.deleted.counts.campaigns)} campaign(s), archived {ago(page.deleted.archived_at)}.
                Every amount, reference, staff name and approval decision in it is the paper a dispute is settled from.
              </p>
            </div>
            <button type="button" className="btn ghost" onClick={downloadRecord} title="Download the kept money record as an Excel file">
              {IC.go}<span>Download the record</span>
            </button>
          </div>
        </section>
      )}

      {page && (
        <p className="facets" data-totals>
          <b>{num(Number(page.totals.credited))}</b> coins in
          <span className="dot"/>
          <b>{num(Number(page.totals.debited))}</b> out
          <span className="dot"/>
          <span>{num(page.totals.entries)} rows written since the table began, none of them editable</span>
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
                <th style={{ width: '19%' }}>Whose wallet</th>
                <th style={{ width: '12%' }}>Movement</th>
                <th style={{ width: '31%' }}>The note on the row</th>
                <th style={{ width: '13%' }}>Staff / reference</th>
                <th style={{ width: '12%' }}>Written</th>
                <th style={{ width: '13%' }}>Wallet now</th>
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
        <td data-label="Staff / reference" className="dim">
          {row.staff && <span className="entry-staff" title="The seat that moved the coins">@{row.staff}</span>}
          {row.ref && <span className="entry-ref" title="What the money was for">{row.ref}</span>}
          {!row.staff && !row.ref && <span>—</span>}
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
  const [matches, setMatches] = useState<SuggestRow[] | null>(null);
  const confirm = useConfirm();
  const suggestSeq = useRef(0);

  // A money row cannot be edited away, so the account is offered, not spelled:
  // every keystroke asks the ledger door who is real, and the answer paints
  // under the field until the seat picks one or clears the box.
  useEffect(() => {
    const query = username.trim();
    if (!query) {
      setMatches(null);
      return;
    }
    const timer = setTimeout(async () => {
      const mine = suggestSeq.current + 1;
      suggestSeq.current = mine;
      try {
        const out = await api<{ results: SuggestRow[] }>(
          `admin/coins/ledger/suggest/?q=${encodeURIComponent(query)}`);
        if (suggestSeq.current === mine) setMatches(out.results);
      } catch {
        if (suggestSeq.current === mine) setMatches(null);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [username]);

  const pick = (row: SuggestRow) => {
    setUsername(row.username);
    setMatches(null);
  };

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
            to come back out, the goodwill credit. This does not change a balance, it adds a row,
            and the wallet’s number is the sum of the rows.
          </p>
        </div>
      </div>

      <div className="adjust-grid">
        <label className="field suggest-wrap">
          <span>Account</span>
          <input
            value={username} onChange={event => setUsername(event.target.value)}
            onBlur={() => setTimeout(() => setMatches(null), 150)}
            placeholder="username" autoComplete="off" name="username"
          />
          {matches !== null && matches.length > 0 && (
            <div className="suggest-pop" role="listbox" aria-label="Matching accounts">
              {matches.map(row => (
                <button
                  key={row.username} type="button" role="option" aria-selected={row.username === username.trim()}
                  className="suggest-item" onMouseDown={() => pick(row)}
                  title={`@${row.username} holds ${row.balance} coins`}
                >
                  {row.avatar
                    ? <img className="suggest-avatar" src={row.avatar} alt=""/>
                    : <span className="suggest-avatar suggest-blank">{row.username.slice(0, 1).toUpperCase()}</span>}
                  <span className="suggest-who">
                    <b>@{row.username}</b>
                    <em>{row.name}</em>
                  </span>
                  <span className="suggest-balance">{row.balance} coins</span>
                </button>
              ))}
            </div>
          )}
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
        <span>Why, it is printed on the row and stays there forever</span>
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
