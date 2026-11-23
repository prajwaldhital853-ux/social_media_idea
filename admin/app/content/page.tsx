'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import ContentCard, { statePill } from '@/components/ContentCard';
import DecisionBar from '@/components/Decision';
import { Act, Chips, More } from '@/components/List';
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
  { id: 'hidden', label: 'Hidden' },
  { id: 'removed', label: 'Taken down' },
  { id: 'live', label: 'Live' },
  { id: 'all', label: 'Everything' },
];

const KIND_LABEL: Record<string, string> = {
  post: 'Post', comment: 'Comment', listing: 'Listing', user: 'Account',
};

/** The raw status each app uses, read the way the shelf is actually organised. */
const COUNT_LABEL: Record<string, string> = {  live: 'in the feed', active: 'live', hidden: 'hidden', removed: 'taken down',
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

      <Chips
        label="Filter by state"
        chips={STATES.map(item => ({
          id: item.id,
          label: item.label,
          n: counts && counts[item.id] !== undefined ? counts[item.id] : undefined,
        }))}
        value={state}
        onPick={setState}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder={type === 'listing' ? 'Search listings by title, description or seller' : `Search ${type} text or author`}
            aria-label="Search content"
          />
        </label>
        <span className="toolbar-count">
          {rows === null ? '…' : <>On this shelf: <b>{rows.length}</b></>}
        </span>
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
        <div className="cases grid-wrap">
          <table className="grid review">
            <thead>
              <tr>
                <th style={{ width: '24%' }}>Target</th>
                <th style={{ width: '7%' }}>Kind</th>
                <th style={{ width: '13%' }}>Standing</th>
                <th style={{ width: '21%' }}>Why it is here</th>
                <th style={{ width: '17%' }}>Decided</th>
                <th style={{ width: '11%' }}>Posted</th>
                <th style={{ width: '7%' }} aria-label="Actions"/>
              </tr>
            </thead>
            {rows.map(row => (
              <ShelfCase
                key={row.target} row={row} state={state}
                onDone={handled} act={act}
              />
            ))}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older"/>
        </div>
      )}
    </ConsoleShell>
  );
}

/**
 * One shelf row. The decision buttons and the content itself live underneath it,
 * so the shelf can hold forty things on one screen and still let a seat read the
 * post before deciding on it. The open state stays with the row's own key, so a
 * decision repaints the row without folding it back up.
 */
function ShelfCase({ row, state, act, onDone }: {
  row: ShelfRow;
  state: string;
  act: (row: ShelfRow, verb: Verb, reason: string, notice: string) => Promise<Outcome>;
  onDone: (out: Outcome) => void;
}) {
  const [open, setOpen] = useState(false);
  const chips = [
    row.pile.open > 0 ? `${row.pile.open} open report${row.pile.open === 1 ? '' : 's'}` : null,
    row.campaigns > 0 ? `${row.campaigns} campaign running` : null,
    row.matches.length > 0 ? `${row.matches.length} blocked-word hit` : null,
  ].filter(Boolean) as string[];
  const line = row.content
    ? [row.content.author ? `@${row.content.author.username}` : '', row.content.title || row.content.text || '']
      .filter(Boolean).join(' — ')
    : '';

  return (
    <tbody className={`case${open ? ' open' : ''}`} data-case={row.target}>
      <tr className={`grid-row${open ? ' open' : ''}`}>
        <td>
          <button
            type="button" className="case-id" aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span className="grid-caret">{IC.chevron}</span>
            <span className="case-name">
              <span className="id">{row.target}</span>
              <span className="case-line dim" title={line}>{line}</span>
            </span>
          </button>
        </td>
        <td className="strong">{KIND_LABEL[row.content.kind] || row.content.kind}</td>
        <td>{statePill(row.content.state, row.content.kind)}</td>
        <td><div className="case-why">
          {chips.length === 0
            ? <span className="dim">—</span>
            : chips.map(entry => <span key={entry} className="chip">{entry}</span>)}
        </div></td>
        <td className="dim">
          {row.decision
            ? `${DONE_LABEL[row.decision.action] || row.decision.action} by ${row.decision.actor || 'the system'}`
            : 'nothing yet'}
        </td>
        <td className="dim">{ago(row.content.created_at)}</td>
        <td><div className="grid-acts">
          <Act
            icon="eye" label={open ? 'Close this row' : 'Open this row'}
            onClick={() => setOpen(!open)}
          />
        </div></td>
      </tr>

      {open && (
        <tr className="grid-detail">
          <td colSpan={7}>
            <div className="grid-body case-body">
              <div>
                <h3>The thing itself</h3>
                <ContentCard content={row.content} matched={row.matches}/>
                {row.decision && (
                  <p className="shelf-decision">
                    <span className={`verb verb-${row.decision.action}`}>
                      {DONE_LABEL[row.decision.action] || row.decision.action}
                    </span>
                    <span>
                      by <b>{row.decision.actor || 'the system'}</b> {ago(row.decision.at)}
                      <em title={stamp(row.decision.at)}>{row.decision.detail}</em>
                    </span>
                  </p>
                )}
              </div>
              <div>
                <h3>Decide</h3>
                <DecisionBar
                  actions={row.actions}
                  permission={row.permission}
                  run={(verb, reason, notice) => act(row, verb, reason, notice)}
                  onDone={onDone}
                  footnote={state === 'taken_down'
                    ? 'Restore puts it back exactly as it was; the author is told.'
                    : undefined}
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
