'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import ContentCard from '@/components/ContentCard';
import DecisionBar from '@/components/Decision';
import { Act, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { ContentKind, Decision as Verb, Outcome, PersonRef, QueuePage, QueueRow } from '@/lib/types';

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
   * gives the whole pile one set of buttons.
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

  const decide = (rep: QueueRow, verb: Verb, reason: string, notice: string) =>
    api<Outcome>(`admin/review/${rep.id}/decide/`, {
      method: 'POST',
      body: { action: verb, reason, notice },
    });

  const handled = (out: Outcome) => {
    setBanner({ kind: 'ok', text: out.detail });
    load();
  };

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
          n: item.id === 'open' && facets ? facets.open : undefined,
        }))}
        value={state}
        onPick={setState}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search by reporter, reason or target id" aria-label="Search reports"
          />
        </label>
        <select value={target} onChange={event => setTarget(event.target.value)} aria-label="Filter by what was reported">
          {TARGETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="toolbar-count">
          {rows === null ? '…' : <>Things to decide: <b>{cases.length}</b></>}
        </span>
      </div>

      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

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
            {cases.map(bucket => <Case key={bucket[0].target} bucket={bucket} onDone={handled} decide={decide}/>)}
          </table>
          <More hasMore={!!cursor} busy={busy} onMore={older} label="Show older reports"/>
        </div>
      )}
    </ConsoleShell>
  );
}

function Case({ bucket, decide, onDone }: {
  bucket: QueueRow[];
  decide: (rep: QueueRow, verb: Verb, reason: string, notice: string) => Promise<Outcome>;
  onDone: (out: Outcome) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showWho, setShowWho] = useState(false);
  const rep = bucket[0];
  const openCount = rep.pile.open;
  const distinct: PersonRef[] = [];
  bucket.forEach(row => {
    if (row.reporter && !distinct.some(who => who.username === row.reporter!.username)) distinct.push(row.reporter);
  });
  const line = rep.content
    ? [rep.content.author ? `@${rep.content.author.username}` : '', rep.content.title || rep.content.text || '']
      .filter(Boolean).join(' — ')
    : 'deleted';

  return (
    <tbody className={`case${open ? ' open' : ''}`} data-case={rep.target}>
      <tr className={`grid-row${open ? ' open' : ''}`}>
        <td>
          <button
            type="button" className="case-id" aria-expanded={open}
            onClick={() => { setOpen(!open); if (open) setShowWho(false); }}
          >
            <span className="grid-caret">{IC.chevron}</span>
            <span className="case-name">
              <span className="id">{rep.target}</span>
              <span className="case-line dim" title={line}>{line}</span>
            </span>
          </button>
        </td>
        <td className="strong">{KINDS[rep.content ? rep.content.kind : ''] || rep.target.split(':')[0]}</td>
        <td>
          <span className={`pile${openCount > 0 ? ' open' : ' shut'}`}>
            {IC.flag}
            <b>{openCount}</b>
            <em>of {rep.pile.reports}</em>
          </span>
        </td>
        <td><div className="case-why">
          {rep.pile.reasons.length === 0
            ? <em className="dim">No reason given</em>
            : rep.pile.reasons.map(entry => (
              <span key={entry.reason} className="chip">{TITLED(entry.reason)} × {entry.n}</span>
            ))}
        </div></td>
        <td>
          <span className="case-who">
            <button
              type="button" className="link" aria-expanded={open && showWho}
              onClick={() => { setShowWho(true); setOpen(true); }}
            >
              {distinct.length} reporter{distinct.length === 1 ? '' : 's'} {(open && showWho) ? '▲' : '▼'}
            </button>
          </span>
        </td>
        <td><div className="case-side">
          {rep.campaigns > 0 && (
            <span className="pill warn" title="Taking it down stops these and refunds the days they never ran">
              {IC.coin}<span>{rep.campaigns} campaign running</span>
            </span>
          )}
        </div></td>
        <td className="dim"><span className="case-age">{ago(rep.created_at)}</span></td>
        <td><div className="grid-acts">
          <Act
            icon="eye" label={open ? 'Close this case' : 'Open this case'}
            onClick={() => setOpen(!open)}
          />
        </div></td>
      </tr>

      {open && (
        <tr className="grid-detail">
          <td colSpan={8}>
            <div className="grid-body case-body">
              <div>
                <h3>The thing reported</h3>
                <ContentCard content={rep.content} matched={rep.matches}/>
                {rep.missing && (
                  <p className="note row">
                    {IC.alert}
                    <span>
                      This target was deleted after it was reported. Dismiss the reports so they stop
                      counting, or leave them — there is nothing left to take down.
                    </span>
                  </p>
                )}
                {showWho && (
                  <>
                    <h3>Who reported it</h3>
                    <ul className="reporters">
                      {bucket.map(row => (
                        <li key={row.id}>
                          <b>@{row.reporter ? row.reporter.username : 'deleted account'}</b>
                          <span>{TITLED(row.reason)}</span>
                          {row.details && <em>{row.details}</em>}
                          <span className="when">{ago(row.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div>
                <h3>Decide</h3>
                <DecisionBar
                  actions={rep.actions}
                  permission={rep.permission}
                  run={(verb, reason, notice) => decide(rep, verb, reason, notice)}
                  onDone={onDone}
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
