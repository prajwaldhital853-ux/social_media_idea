'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import ContentCard from '@/components/ContentCard';
import DecisionBar from '@/components/Decision';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { ContentKind, Decision as Verb, Outcome, ShelfPage, ShelfRow } from '@/lib/types';

const TYPES: { id: ContentKind; label: string; key: string }[] = [
  { id: 'post', label: 'Posts', key: 'content' },
  { id: 'comment', label: 'Comments', key: 'content' },
  { id: 'listing', label: 'Listings', key: 'listings' },
];

const STATES = [
  { id: 'taken_down', label: 'Off the platform' },
  { id: 'hidden', label: 'Hidden pending review' },
  { id: 'removed', label: 'Taken down by staff' },
  { id: 'live', label: 'Live' },
  { id: 'all', label: 'Everything' },
];

/** The raw status each app uses, read the way the shelf is actually organised. */
const COUNT_LABEL: Record<string, string> = {
  live: 'in the feed', active: 'live', hidden: 'hidden', removed: 'taken down',
};

/** The audit action, said the way the shelf header says it. */
const DONE_LABEL: Record<string, string> = {
  remove_content: 'Taken down',
  restore_content: 'Restored',
  release_content: 'Released',
  public_notice: 'Public notice',
  dismiss_reports: 'Reports dismissed',
};

export default function ContentPage() {
  const { can, status, noteGate } = useSession();
  /*
   * Which kind the shelf opens on is decided by the seat, and the seat is only
   * known once the session answers — so nothing is fetched before then, and a
   * seat that reviews listings is not walked to a posts list it cannot read.
   */
  const [picked, setPicked] = useState<ContentKind | null>(null);
  const type: ContentKind = picked || (status === 'in' && !can('content') ? 'listing' : 'post');
  const [state, setState] = useState('taken_down');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The search box answers every keystroke, so three requests for one word can
  // land in any order, and the one that arrives last is not the one that was
  // typed last. Each call takes a number and only the newest may paint the shelf.
  const seq = useRef(0);

  const fetchPage = useCallback(async (after: string | null) => {
    const params = new URLSearchParams();
    params.set('type', type);
    params.set('state', state);
    if (q.trim()) params.set('q', q.trim());
    if (after) params.set('cursor', after);
    return api<ShelfPage>(`admin/content/?${params}`);
  }, [q, state, type]);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const page = await fetchPage(null);
      if (seq.current !== mine) return;
      setRows(page.results);
      setCounts(page.counts);
      setCursor(page.next_cursor);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  }, [fetchPage, noteGate]);

  useEffect(() => {
    if (status === 'in') load();
  }, [status, load]);

  const older = async () => {
    if (!cursor) return;
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const page = await fetchPage(cursor);
      // A search typed while this was in flight owns the shelf now, so its answer
      // is the one that gets painted and these older rows are dropped.
      if (seq.current !== mine) return;
      setRows(list => [...(list || []), ...page.results]);
      setCursor(page.next_cursor);
      setCounts(page.counts);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  };

  const act = (row: ShelfRow, verb: Verb, reason: string, notice: string) => {
    const [kind, id] = row.target.split(':');
    return api<Outcome>(`admin/content/${kind}/${id}/`, {
      method: 'POST', body: { action: verb, reason, notice },
    });
  };

  const handled = (out: Outcome) => {
    setBanner({ kind: 'ok', text: out.detail });
    load();
  };

  return (
    <ConsoleShell
      title="Takedown shelf"
      subtitle="Everything staff or the report counter moved out of the feed, with the sentence that took it down and the verb that puts it back."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the shelf">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <div className="tabs" role="tablist" aria-label="What kind of content">
        {TYPES.map(item => (
          <button
            key={item.id} type="button" role="tab" aria-selected={type === item.id}
            className={`tab${type === item.id ? ' active' : ''}`}
            disabled={!can(item.key)}
            title={can(item.key) ? undefined : `This seat does not hold ${item.key === 'content' ? 'Post and comment review' : 'Marketplace listing review'}`}
            onClick={() => setPicked(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder={type === 'listing' ? 'Search listings by title, description or seller' : `Search ${type} text or author`}
            aria-label="Search content"
          />
        </label>
        <select value={state} onChange={event => setState(event.target.value)} aria-label="Filter by state">
          {STATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="toolbar-count">{rows === null ? '…' : `${rows.length} shown`}</span>
      </div>

      {counts && (
        <p className="facets">
          {Object.keys(COUNT_LABEL).filter(raw => counts[raw] !== undefined).map(raw => (
            <span key={raw}><b>{num(counts[raw])}</b> {COUNT_LABEL[raw]}</span>
          ))}
        </p>
      )}

      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : rows.length === 0 ? (
        <section className="panel empty">
          <h2>The shelf is empty</h2>
          <p>
            Nothing of this kind is in that state. Content arrives here the moment it is hidden by
            the report counter or taken down by a seat with the pen for it.
          </p>
        </section>
      ) : (
        <div className="cases">
          {rows.map(row => (
            <section key={row.target} className="case" data-case={row.target}>
              <header className="case-head">
                <span className="case-why">
                  {row.pile.open > 0
                    ? <span className="chip">{row.pile.open} open report{row.pile.open === 1 ? '' : 's'}</span>
                    : <span className="chip">no open reports</span>}
                  {row.campaigns > 0 && <span className="chip">{row.campaigns} campaign running</span>}
                  {row.matches.length > 0 && <span className="chip">{row.matches.length} blocked-word hit</span>}
                </span>
                <span className="case-side">
                  <span className="case-age">{ago(row.content.created_at)}</span>
                </span>
              </header>

              <ContentCard content={row.content} matched={row.matches}/>

              {row.decision && (
                <p className="shelf-decision">
                  <span className={`verb verb-${row.decision.action}`}>{DONE_LABEL[row.decision.action] || row.decision.action}</span>
                  <span>
                    by <b>{row.decision.actor || 'the system'}</b> {ago(row.decision.at)}
                    <em title={stamp(row.decision.at)}>{row.decision.detail}</em>
                  </span>
                </p>
              )}

              <DecisionBar
                actions={row.actions}
                permission={row.permission}
                run={(verb, reason, notice) => act(row, verb, reason, notice)}
                onDone={handled}
                footnote={state === 'taken_down'
                  ? 'Restore puts it back exactly as it was; the author is told.'
                  : undefined}
              />
            </section>
          ))}
        </div>
      )}

      {cursor && (
        <button type="button" className="btn ghost wide" disabled={busy} onClick={older}>
          {IC.go}<span>Show older</span>
        </button>
      )}
    </ConsoleShell>
  );
}
