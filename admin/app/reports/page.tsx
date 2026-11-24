'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { PeoplePicks } from '@/components/Find';
import { ActLink, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { ContentKind, QueuePage, QueueRow } from '@/lib/types';

const TARGETS = [
  { id: '', label: 'Anything reported' },
  { id: 'post', label: 'Posts' },
  { id: 'comment', label: 'Comments' },
  { id: 'listing', label: 'Listings' },
  { id: 'user', label: 'Accounts' },
];

const STATES = [
  { id: 'open', label: 'Waiting' },
  { id: 'resolved', label: 'Handled' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'Every report' },
];

const TITLED = (text: string) => text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

const KINDS: Record<string, string> = {
  post: 'Post', comment: 'Comment', listing: 'Listing', user: 'Account',
};

const TALLY: { kind: ContentKind; label: string }[] = [
  { kind: 'post', label: 'posts' },
  { kind: 'comment', label: 'comments' },
  { kind: 'listing', label: 'listings' },
  { kind: 'user', label: 'accounts' },
];

const tally = (facets: QueuePage['facets'], kind: ContentKind) => facets.by_target[kind] || 0;

export default function ReportsPage() {
  const { noteGate } = useSession();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [facets, setFacets] = useState<QueuePage['facets'] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState('');
  const [state, setState] = useState('open');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The search box answers every keystroke, so three requests for one word can
  // land in any order, and the one that arrives last is not the one that was
  // typed last. Each call takes a number and only the newest may paint the queue.
  const seq = useRef(0);

  const fetchPage = useCallback(async (after: string | null) => {
    const params = new URLSearchParams();
    params.set('status', state);
    if (target) params.set('target', target);
    if (q.trim()) params.set('q', q.trim());
    if (after) params.set('cursor', after);
    return api<QueuePage>(`admin/review/?${params}`);
  }, [q, state, target]);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const page = await fetchPage(null);
      if (seq.current !== mine) return;
      setRows(page.results);
      setFacets(page.facets);
      setCursor(page.next_cursor);
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
      const page = await fetchPage(cursor);
      // A search typed while this was in flight owns the queue now, so its answer
      // is the one that gets painted and these older rows are dropped.
      if (seq.current !== mine) return;
      setRows(list => [...(list || []), ...page.results]);
      setCursor(page.next_cursor);
      setFacets(page.facets);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  };

  /**
   * Reports arrive one per person, but a decision is made about a post. Grouping
   * the page by target is what turns "14 rows" into "4 things to decide" and
   * gives the whole pile one line, one count and one page to open.
   */
  const cases = useMemo(() => {
    const byTarget = new Map<string, QueueRow[]>();
    (rows || []).forEach(row => {
      const bucket = byTarget.get(row.target);
      if (bucket) bucket.push(row);
      else byTarget.set(row.target, [row]);
    });
    return Array.from(byTarget.values());
  }, [rows]);

  return (
    <ConsoleShell
      title="Report queue"
      subtitle="What people have flagged, the thing itself beside it, and one decision that speaks for every report on it."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the queue">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Chips
        label="Filter by where the report stands"
        chips={STATES.map(item => ({
          id: item.id,
          label: item.label,
          n: facets ? facets[item.id as 'open' | 'resolved' | 'dismissed' | 'all'] : undefined,
        }))}
        value={state}
        onPick={setState}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search by a word in the report, or by the name, username or email of whoever wrote or reported the thing"
            aria-label="Search reports"
          />
        </label>
        <select value={target} onChange={event => setTarget(event.target.value)} aria-label="Filter by what was reported">
          {TARGETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="toolbar-count">
          {rows === null ? '…' : <>Things to decide: <b>{cases.length}</b></>}
        </span>
      </div>

      {/* A seat comes to this queue with a person's name, not a target id, so the
          desk lists the people that name could mean and one click filters to them. */}
      <PeoplePicks query={q} onPick={hit => setQ(hit.fill)}/>

      <Banner banner={banner} />

      {facets && (
        <p className="facets">
          <b>{num(facets.open)}</b> reports waiting for a decision
          <span className="dot"/>
          {TALLY.map(item => (
            <span key={item.kind}>{num(tally(facets, item.kind))} {item.label}</span>
          ))}
          <span className="dot"/>
          <span>the feed hides a post at {facets.auto_hide_at} different reporters</span>
        </p>
      )}

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : cases.length === 0 ? (
        <section className="panel empty">
          <h2>Nothing here</h2>
          <p>
            {state === 'open'
              ? 'No report is waiting on this seat. New ones arrive the moment someone taps Report.'
              : 'No report matches this view. Try widening the filter.'}
          </p>
        </section>
      ) : (
        <div className="cases grid-wrap">
          <table className="grid review">
            <thead>
              <tr>
                <th style={{ width: '24%' }}>Target</th>
                <th style={{ width: '7%' }}>Kind</th>
                <th style={{ width: '9%' }}>Open</th>
                <th style={{ width: '21%' }}>Reasons given</th>
                <th style={{ width: '11%' }}>Reporters</th>
                <th style={{ width: '10%' }}>Paid reach</th>
                <th style={{ width: '12%' }}>Last report</th>
                <th style={{ width: '6%' }} aria-label="Actions"/>
              </tr>
            </thead>
            {cases.map(bucket => <Case key={bucket[0].target} bucket={bucket}/>)}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older reports"/>
        </div>
      )}
    </ConsoleShell>
  );
}

function Case({ bucket }: { bucket: QueueRow[] }) {
  const rep = bucket[0];
  const openCount = rep.pile.open;
  const reporters = new Set(bucket.map(row => row.reporter?.username).filter(Boolean)).size;
  const line = rep.content
    ? [rep.content.author ? `@${rep.content.author.username}` : '', rep.content.title || rep.content.text || '']
      .filter(Boolean).join(' — ')
    : 'deleted';
  const href = `/review/${rep.target_type}/${rep.target_id}`;

  return (
    <tbody className="case" data-case={rep.target}>
      <tr className="grid-row">
        <td data-label="Target">
          <Link href={href} className="case-id">
            <span className="grid-caret">{IC.chevron}</span>
            <span className="case-name">
              <span className="id">{rep.target}</span>
              <span className="case-line dim" title={line}>{line}</span>
            </span>
          </Link>
        </td>
        <td data-label="Kind" className="strong">{KINDS[rep.content ? rep.content.kind : ''] || rep.target.split(':')[0]}</td>
        <td data-label="Open">
          <span className={`pile${openCount > 0 ? ' open' : ' shut'}`}>
            {IC.flag}
            <b>{openCount}</b>
            <em>of {rep.pile.reports}</em>
          </span>
        </td>
        <td data-label="Reasons given"><div className="case-why">
          {rep.pile.reasons.length === 0
            ? <em className="dim">No reason given</em>
            : rep.pile.reasons.map(entry => (
              <span key={entry.reason} className="chip">{TITLED(entry.reason)} × {entry.n}</span>
            ))}
        </div></td>
        <td data-label="Reporters">
          <Link href={href} className="link">
            {reporters} reporter{reporters === 1 ? '' : 's'}
          </Link>
        </td>
        <td data-label="Paid reach"><div className="case-side">
          {rep.campaigns > 0 && (
            <span className="pill warn" title="Taking it down stops these and refunds the days they never ran">
              {IC.coin}<span>{rep.campaigns} campaign running</span>
            </span>
          )}
          {rep.missing && <span className="pill mute">deleted</span>}
        </div></td>
        <td data-label="Last report" className="dim"><span className="case-age">{ago(rep.created_at)}</span></td>
        <td data-label="Actions"><div className="grid-acts">
          <ActLink to={href} icon="eye" label="Open this case"/>
        </div></td>
      </tr>
    </tbody>
  );
}
