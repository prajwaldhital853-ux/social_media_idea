'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import { Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { AuditLine, AuditPage } from '@/lib/types';

/**
 * Contract 6.9, the log of every staff action.
 *
 * The table itself is append-only and lives in the moderation app; this screen only
 * reads it. What it is built to answer is the question that gets asked in March about
 * January: *who* turned this off, *when*, and *what they typed as the reason*. So the
 * reason is a column of its own rather than a tooltip, the actor is named even when the
 * actor was the platform itself, and the families the contract promises to record are
 * printed with their zeroes, because "coin approvals are not logged" and "there were
 * no coin approvals this month" look identical in an empty filter list, and the
 * difference is the whole point of an audit.
 */

const ALL = { id: '', label: 'Every kind of action' };

export default function AuditScreen() {
  const { noteGate } = useSession();
  const [page, setPage] = useState<AuditPage | null>(null);
  const [rows, setRows] = useState<AuditLine[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [family, setFamily] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const fetchPage = useCallback((after: string | null) => {
    const params = new URLSearchParams();
    if (family) params.set('family', family);
    if (actor) params.set('actor', actor);
    if (action) params.set('action', action);
    if (q.trim()) params.set('q', q.trim());
    if (since.trim()) params.set('since', since.trim());
    if (until.trim()) params.set('until', until.trim());
    if (after) params.set('cursor', after);
    return api<AuditPage>(`admin/audit/?${params}`);
  }, [family, actor, action, q, since, until]);

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
      setBanner(null);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner((err as Error).message);
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
      if (!noteGate(err)) setBanner((err as Error).message);
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  };

  // The families come back with their own numbers; "every kind of action" adds
  // them up so the first chip is not the one blank page.
  const chips = [
    { ...ALL, n: page ? page.facets.families.reduce((sum, item) => sum + item.n, 0) : null },
    ...(page?.facets.families || []).map(item => ({ id: item.id, label: item.label, n: item.n })),
  ];
  const missing = (page?.facets.families || []).filter(item => item.contract && item.n === 0);

  return (
    <ConsoleShell
      title="Audit log"
      subtitle="Every moderation decision, warning, suspension, Coin approval and adjustment, promotion call, rule change and export this console has made, who did it, when, and the reason that was typed with it. Nothing here edits or removes a row."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Read the log again">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Chips
        label="Filter the log by the kind of action"
        chips={chips}
        value={family}
        onPick={setFamily}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search the target or the reason" aria-label="Search the audit log"
          />
        </label>
        <select value={actor} onChange={event => setActor(event.target.value)} aria-label="Filter by who wrote it">
          <option value="">Anyone</option>
          {(page?.facets.actors || []).map(item => (
            <option key={item.actor} value={item.actor}>{item.actor}, {item.n}</option>
          ))}
        </select>
        <select value={action} onChange={event => setAction(event.target.value)} aria-label="Filter by the exact verb">
          <option value="">Any verb</option>
          {(page?.facets.actions || []).map(item => (
            <option key={item.action} value={item.action}>{item.action}, {item.n}</option>
          ))}
        </select>
        <label className="dates">
          <span>From</span>
          <input
            value={since} onChange={event => setSince(event.target.value)}
            placeholder="2026-11-01" aria-label="Entries from this date" autoComplete="off" maxLength={16}
          />
          <span>to</span>
          <input
            value={until} onChange={event => setUntil(event.target.value)}
            placeholder="2026-11-22" aria-label="Entries up to this date" autoComplete="off" maxLength={16}
          />
        </label>
        <span className="toolbar-count">
          {rows === null ? '…' : <>Rows on screen: <b>{rows.length}</b></>}
        </span>
      </div>

      {banner && <p className="banner banner-bad" role="status">{IC.alert}<span>{banner}</span></p>}

      {page && (
        <p className="facets" data-totals>
          <b>{num(page.summary.entries)}</b> entries match this filter
          <span className="dot"/>
          <b>{num(page.summary.people)}</b> account{page.summary.people === 1 ? '' : 's'} wrote them
          <span className="dot"/>
          <b>{num(page.summary.system)}</b> by the platform itself
          <span className="dot"/>
          <span>
            {page.whole.entries} rows in the log since it began, newest {ago(page.whole.newest)}
          </span>
        </p>
      )}

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : rows.length === 0 ? (
        <section className="panel empty">
          <h2>Nothing matches</h2>
          <p>
            No entry carries this combination of kind, account, verb and dates. A log row is never
            deleted, so an empty result here is a question about the window, not about what anybody
            cleaned up.
          </p>
        </section>
      ) : (
        <div className="ledger grid-wrap">
          <table className="grid review" data-list="audit">
            <thead>
              <tr>
                <th style={{ width: '15%' }}>Who</th>
                <th style={{ width: '17%' }}>What they did</th>
                <th style={{ width: '14%' }}>To what</th>
                <th style={{ width: '38%' }}>The reason on the row</th>
                <th style={{ width: '16%' }}>When</th>
              </tr>
            </thead>
            {rows.map(row => <Entry key={row.id} row={row}/>)}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Go further back"/>
        </div>
      )}

      {page && missing.length > 0 && (
        <p className="note" data-missing-families>
          {IC.alert}
          <span>
            The contract names {missing.length} kind{missing.length === 1 ? '' : 's'} of action this log
            has never recorded: {missing.map(item => item.label.toLowerCase()).join(', ')}. A zero here is
            a promise nobody has had to keep yet, not a hole in the logging.
          </span>
        </p>
      )}

      {page && (
        <p className="note">
          A date with no clock on it is read as the whole day, so “to 2026-11-22” includes the last
          second of the 22nd. Nothing on this screen writes: the log is appended to by the doors that
          take the actions, and a row that could be edited here would not be evidence.
        </p>
      )}
    </ConsoleShell>
  );
}

function Entry({ row }: { row: AuditLine }) {
  return (
    <tbody className="entry" data-entry={row.id}>
      <tr className="grid-row">
        <td data-label="Who">
          <span className="entry-who">
            {row.actor
              ? <><b>{row.actor}</b><em>staff seat</em></>
              : <><b>the platform itself</b><em>no account behind it</em></>}
          </span>
        </td>
        <td data-label="What they did">
          <span className={`verb verb-${row.action}`}>{row.action.replace(/_/g, ' ')}</span>
          <em className="coin-way">{row.family}</em>
        </td>
        <td data-label="To what" className="dim">
          <span className="entry-note" title={row.target}>{row.target || '-'}</span>
        </td>
        <td data-label="The reason on the row">
          <span className="entry-note" title={row.detail}>{row.detail || 'no reason was typed'}</span>
        </td>
        <td data-label="When" className="dim" title={stamp(row.created_at)}>{ago(row.created_at)}</td>
      </tr>
    </tbody>
  );
}
