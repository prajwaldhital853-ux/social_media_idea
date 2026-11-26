'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { ActLink, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { PeopleFacets, PersonPage, PersonRow, PersonVerbs } from '@/lib/types';

const STATES = [
  { id: 'all', label: 'Everyone' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'flagged', label: 'Flagged' },
  { id: 'locked', label: 'Sign-in locked' },
  { id: 'verified', label: 'Verified' },
  { id: 'unverified', label: 'No tick' },
  { id: 'inactive', label: 'Deactivated' },
];

const PROVIDERS = [
  { id: 'all', label: 'Signed up any way' },
  { id: 'email', label: 'By email' },
  { id: 'google', label: 'With Google' },
  { id: 'facebook', label: 'With Facebook' },
  { id: 'apple', label: 'With Apple' },
];

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Client seat', admin: 'Admin seat', moderator: 'Moderator seat', user: 'Member',
};

export default function PeoplePage() {
  const { status, noteGate, session } = useSession();
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [provider, setProvider] = useState('all');
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [facets, setFacets] = useState<PeopleFacets | null>(null);
  const [verbs, setVerbs] = useState<PersonVerbs>({ actions: false, warn: false });
  const [cursor, setCursor] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The search box answers every keystroke, so three requests for one word can
  // land in any order, and the one that arrives last is not the one that was
  // typed last. Each call takes a number and only the newest may paint the list.
  const seq = useRef(0);

  const fetchPage = useCallback(async (after: string | null) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (state !== 'all') params.set('status', state);
    if (provider !== 'all') params.set('provider', provider);
    if (after) params.set('cursor', after);
    return api<PersonPage>(`admin/people/?${params}`);
  }, [provider, q, state]);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const page = await fetchPage(null);
      if (seq.current !== mine) return;
      setRows(page.results);
      setFacets(page.facets);
      setVerbs(page.can);
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
      // A search typed while this was in flight owns the list now, so these
      // older accounts belong to a view nobody is looking at.
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

  return (
    <ConsoleShell
      title="User directory"
      subtitle="Every account on the platform, how each one signed up, what is piled on it, and what a seat can do about it."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the directory">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Chips
        label="Filter by state" value={state} onPick={setState}
        chips={STATES.map(item => ({
          ...item,
          n: facets === null ? null
            : item.id === 'all' ? facets.total
              : item.id === 'suspended' ? facets.suspended
                : item.id === 'flagged' ? facets.flagged
                  : item.id === 'locked' ? facets.locked
                    : item.id === 'verified' ? facets.verified
                      : item.id === 'unverified' ? facets.total - facets.verified
                        : item.id === 'inactive' ? facets.deactivated : null,
        }))}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search by name, email or username" aria-label="Search users"
          />
        </label>
        <select value={provider} onChange={event => setProvider(event.target.value)} aria-label="Filter by sign-up method">
          {PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="toolbar-count">
          Accounts: <b>{facets === null ? '…' : num(facets.total)}</b>
        </span>
      </div>

      {facets && (
        <p className="facets" data-list="people-facets">
          <span><b>{num(facets.total)}</b> accounts</span>
          <span><b>{num(facets.suspended)}</b> suspended</span>
          <span><b>{num(facets.flagged)}</b> flagged at {facets.auto_hide_at}+ reporters</span>
          <span><b>{num(facets.locked)}</b> sign-in locked</span>
          <span><b>{num(facets.verified)}</b> verified</span>
          {facets.permanent > 0 && <span><b>{num(facets.permanent)}</b> suspended for good</span>}
          {facets.deactivated > 0 && <span><b>{num(facets.deactivated)}</b> deactivated</span>}
        </p>
      )}

      <Banner banner={banner} />

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : rows.length === 0 ? (
        <section className="panel empty">
          <h2>Nobody matches this view</h2>
          <p>
            Clear the search or pick another state. Every account that has ever finished signing up
            is here, including ones suspended or deactivated.
          </p>
        </section>
      ) : (
        <div className="grid-wrap flow">
          <table className="grid people">
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Email</th>
                <th>Seat</th>
                <th>Signed up</th>
                <th className="num">Posts</th>
                <th className="num">Followers</th>
                <th className="num">Coins</th>
                <th>Standing</th>
                <th>Access</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            {rows.map(row => (
              <PersonRowView
                key={row.id} row={row} verbs={verbs} mine={row.username === session?.user.username}
              />
            ))}
          </table>
        </div>
      )}

      <More hasMore={!!cursor} busy={busy} onMore={older} label="Load more accounts" />
    </ConsoleShell>
  );
}

/**
 * A row is a summary, not a drawer. Everything underneath it, the pile, the
 * warnings, the wallet, the act-on buttons, lives on the account's own page,
 * so the directory never grows eleven columns tall mid-scroll.
 */
function PersonRowView({ row, verbs, mine }: { row: PersonRow; verbs: PersonVerbs; mine: boolean }) {
  const holding = row.flags.on_account + row.flags.on_content;
  const barred = !!row.suspension;
  // Column order below the eye is the pair block's reading order: lock first so
  // the two-by-two lands eye/pencil on the left and lock/delete on the right.
  const offered: { verb: string; icon: keyof typeof IC; label: string; act: string }[] = [
    barred
      ? { verb: 'reinstate', icon: 'check', label: 'Reinstate', act: 'reinstate' }
      : { verb: 'suspend', icon: 'lock', label: 'Suspend', act: 'suspend' },
    { verb: 'warn', icon: 'pen', label: 'Private warning', act: 'warn' },
    { verb: 'delete', icon: 'trash', label: 'Delete account', act: 'delete' },
  ];
  // Name and domain each take a line, so the column stops asking for half the desk.
  const at = row.email.indexOf('@');
  const mailLocal = at > 0 ? row.email.slice(0, at) : row.email;
  const mailDomain = at > 0 ? row.email.slice(at + 1) : '';

  return (
    <tbody className="person" data-person={row.username}>
      <tr className="grid-row">
        <td data-label="Username">
          <Link href={`/people/${row.username}`} className="person-id">
            <span className="grid-caret">{IC.chevron}</span>
            <span className="id">@{row.username}</span>
          </Link>
        </td>
        <td data-label="Name" className="strong">
          <span className="person-name">
            {row.name}
            {row.verified && <span className="verified" title="Verified by staff">✓</span>}
          </span>
        </td>
        <td data-label="Email" className="dim">
          {at > 0
            ? <span className="mail-cut"><b>{mailLocal}</b><small>@{mailDomain}</small></span>
            : row.email || '-'}
        </td>
        <td data-label="Seat">{ROLE_LABEL[row.role] || row.role}</td>
        <td data-label="Signed up" className="dim">joined {ago(row.joined)}</td>
        <td data-label="Posts" className="num">{num(row.posts)}</td>
        <td data-label="Followers" className="num">{num(row.followers)}</td>
        <td data-label="Coins" className="num" title="Wallet balance">{row.coins}</td>
        <td data-label="Standing">
          <div className="person-flags">
            <span className="pill mute" title="How this account first reached the platform">{row.provider_label}</span>
            {!row.email_verified && <span className="pill warn">email unverified</span>}
            {barred ? (
              <span className="pill dead" title={row.suspension!.reason || undefined}>
                {IC.lock}<span>{row.suspension!.permanent ? 'Suspended for good' : `Suspended to ${row.suspension!.until.slice(0, 10)}`}</span>
              </span>
            ) : <span className="pill good">In good standing</span>}
            {row.locked_until && Date.parse(row.locked_until) > Date.now() && (
              <span className="pill warn">{row.failed_attempts} failed sign-ins, locked</span>
            )}
            {holding > 0 && (
              <span className={`pile ${holding >= row.flags.auto_hide_at ? 'open' : ''}`}
                    title={`${row.flags.reporters} distinct reporters`}>
                {holding} report{holding === 1 ? '' : 's'} against {row.flags.reporters} reporter{row.flags.reporters === 1 ? '' : 's'}
              </span>
            )}
            {!row.notify_email && <span className="pill mute">warning emails off</span>}
            {!row.notify_follow_email && <span className="pill mute">follower emails off</span>}
            {mine && <span className="pill mute">You</span>}
          </div>
        </td>
        <td data-label="Access">
          <span className={`state ${verbs.actions || verbs.warn ? 'good' : 'mute'}`}>
            {verbs.actions ? 'Full' : verbs.warn ? 'Warn only' : 'View only'}
          </span>
        </td>
        <td data-label="Actions">
          <div className="grid-acts pair">
            <ActLink to={`/people/${row.username}`} icon="eye" label="Open this account"/>
            {offered.map(item => (
              <ActLink
                key={item.verb}
                to={`/people/${row.username}?act=${item.act}`}
                icon={item.icon}
                label={`${item.label}, opens the account with this ask written`}
                tone={item.verb === 'delete' ? 'dead' : undefined}
                disabled={mine || !(item.verb === 'warn' ? verbs.warn : verbs.actions)}
              />
            ))}
          </div>
        </td>
      </tr>
    </tbody>
  );
}
