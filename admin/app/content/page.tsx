'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { statePill } from '@/components/ContentCard';
import { PeoplePicks } from '@/components/Find';
import { Act, ActLink, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { ContentKind, Outcome, ShelfPage, ShelfRow } from '@/lib/types';

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
            placeholder={type === 'listing'
              ? 'Search a listing by its title, its description, or whoever is selling it'
              : `Search a ${type} by what it says, or by the name, username or email of whoever wrote it`}
            aria-label="Search content"
          />
        </label>
        <span className="toolbar-count">
          {rows === null ? '…' : <>On this shelf: <b>{rows.length}</b></>}
        </span>
      </div>

      {/* The word is a person's name, so the desk lists the people it could mean
          and a seat picks one instead of hoping the spelling matches. */}
      <PeoplePicks query={q} onPick={hit => setQ(hit.fill)}/>

      {counts && (
        <p className="facets">
          {Object.keys(COUNT_LABEL).filter(raw => counts[raw] !== undefined).map(raw => (
            <span key={raw}><b>{num(counts[raw])}</b> {COUNT_LABEL[raw]}</span>
          ))}
        </p>
      )}

      <Banner banner={banner} />

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
                key={row.target} row={row}
                onWarn={(text, bad) => {
                  setBanner({ kind: bad ? 'bad' : 'ok', text });
                  if (!bad) load();
                }}
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
 * One shelf row. It says how the thing stands and who moved it; the thing itself,
 * the reports behind it and the five verbs live on the page the row opens, which
 * is the same page a report queue row opens — a seat should not have to remember
 * which desk it came from to decide about one post.
 *
 * The warning is the one verb short enough to sign here: a seat who has found the
 * post and knows the sentence should not have to open a page to say it.
 */
function ShelfCase({ row, onWarn }: { row: ShelfRow; onWarn: (text: string, bad?: boolean) => void }) {
  const { can, noteGate } = useSession();
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [audience, setAudience] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const chips = [
    row.pile.open > 0 ? `${row.pile.open} open report${row.pile.open === 1 ? '' : 's'}` : null,
    row.campaigns > 0 ? `${row.campaigns} campaign running` : null,
    row.matches.length > 0 ? `${row.matches.length} blocked-word hit` : null,
  ].filter(Boolean) as string[];
  const line = row.content
    ? [row.content.author ? `@${row.content.author.username}` : '', row.content.title || row.content.text || '']
      .filter(Boolean).join(' — ')
    : '';
  const href = `/review/${row.target.replace(':', '/')}`;
  const [kind, , targetId] = row.target.split(':');
  const mayWarn = row.actions.includes('warn') && can(row.permission || 'content');

  const privateNote = audience === 'private';

  const warn = async () => {
    const sure = await confirm({
      title: privateNote ? `Put a notice only they can read on ${row.target}?` : `Put a public warning on ${row.target}?`,
      body: privateNote
        ? 'The content stays up and the sentence shows above it to the person who wrote it — and to '
          + 'nobody else. They are told in their own bell, and the audit row keeps your name with it.'
        : 'The content stays up and everyone who reaches it reads your sentence above it. '
          + 'The author also gets a private warning, and the audit row keeps your name with it.',
      confirmLabel: 'Put it up',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    try {
      const out = await api<Outcome>(`admin/content/${kind}/${targetId}/`, {
        method: 'POST',
        body: { action: 'warn', notice: notice.trim(), reason: reason.trim(), audience },
      });
      setAsking(false);
      setNotice('');
      setReason('');
      onWarn(out.detail);
    } catch (err) {
      if (!noteGate(err)) onWarn((err as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tbody className="case" data-case={row.target}>
      <tr className="grid-row">
        <td data-label="Target">
          <Link href={href} className="case-id">
            <span className="grid-caret">{IC.chevron}</span>
            <span className="case-name">
              <span className="id">{row.target}</span>
              <span className="case-line dim" title={line}>{line}</span>
            </span>
          </Link>
        </td>
        <td data-label="Kind" className="strong">{KIND_LABEL[row.content.kind] || row.content.kind}</td>
        <td data-label="Standing">{statePill(row.content.state, row.content.kind)}</td>
        <td data-label="Why it is here"><div className="case-why">
          {chips.length === 0
            ? <span className="dim">—</span>
            : chips.map(entry => <span key={entry} className="chip">{entry}</span>)}
        </div></td>
        <td data-label="Decided" className="dim">
          {row.decision
            ? `${DONE_LABEL[row.decision.action] || row.decision.action} by ${row.decision.actor || 'the system'}`
            : 'nothing yet'}
        </td>
        <td data-label="Posted" className="dim">{ago(row.content.created_at)}</td>
        <td data-label="Actions"><div className="grid-acts">
          <ActLink to={href} icon="eye" label="Open this row"/>
          {mayWarn && (
            <Act
              icon="mega" label={asking ? 'Close the warning' : 'Warn about this'}
              onClick={() => setAsking(value => !value)} disabled={busy}
            />
          )}
        </div></td>
      </tr>
      {asking && (
        <tr className="grid-ask">
          <td colSpan={7}>
            <div className="ask">
              <div className="term-add">
                <label className="field">
                  <span>Who reads it</span>
                  <select
                    value={audience} aria-label="Who reads the notice"
                    onChange={event => setAudience(event.target.value as 'public' | 'private')}
                  >
                    <option value="public">Everyone who reaches it</option>
                    <option value="private">Only the person who wrote it</option>
                  </select>
                </label>
                <label className="field grow">
                  <span>{privateNote
                    ? `The sentence only they read over this ${KIND_LABEL[kind] || kind}`
                    : `The sentence everyone reads over this ${KIND_LABEL[kind] || kind}`}</span>
                  <textarea
                    rows={2} value={notice} maxLength={240} autoFocus
                    placeholder={privateNote
                      ? 'e.g. Two claims here have been checked and are wrong. Put a correction up before this reaches more people.'
                      : "e.g. This post has been flagged as misleading. Read the author's correction before sharing it."}
                    onChange={event => setNotice(event.target.value)}
                  />
                </label>
              </div>
              <label className="field grow">
                <span>Why — kept on the record with your name (optional)</span>
                <input
                  value={reason} maxLength={120} placeholder="What about it broke the rules"
                  onChange={event => setReason(event.target.value)}
                />
              </label>
              <div className="ask-actions">
                <button
                  type="button" className="btn amber tiny" disabled={busy || notice.trim() === ''}
                  onClick={warn}
                >
                  {IC.mega}<span>{busy ? 'Putting it up…' : privateNote ? 'Put the private notice up' : 'Put the warning up'}</span>
                </button>
                <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => setAsking(false)}>
                  <span>Cancel</span>
                </button>
                <Link href={href} className="btn ghost tiny"><span>Open the whole case</span>{IC.chevron}</Link>
              </div>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
