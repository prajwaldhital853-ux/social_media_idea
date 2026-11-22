'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import { Act, Chips, More } from '@/components/List';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import {
  PeopleFacets, PersonDetail, PersonOutcome, PersonPage, PersonRow, PersonVerbs,
} from '@/lib/types';

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

type Verb = 'suspend' | 'reinstate' | 'verify' | 'warn' | 'clear_flags' | 'delete';

const PATH: Record<Verb, (username: string) => string> = {
  suspend: username => `admin/people/${username}/suspend/`,
  reinstate: username => `admin/people/${username}/reinstate/`,
  verify: username => `admin/people/${username}/verify/`,
  warn: username => `admin/people/${username}/warn/`,
  clear_flags: username => `admin/people/${username}/clear-flags/`,
  delete: username => `admin/people/${username}/delete/`,
};

const SPEC: Record<Verb, { label: string; tone: string; icon: keyof typeof IC; help: string }> = {
  suspend: {
    label: 'Suspend', tone: 'danger', icon: 'lock',
    help: 'They stop being able to sign in at their next request, lose every open session, and are emailed the reason with the Client contact details.',
  },
  reinstate: {
    label: 'Reinstate', tone: 'primary', icon: 'check',
    help: 'The bar is lifted right now and they are told in the app. Nothing else about the account changes.',
  },
  verify: {
    label: 'Verified tick', tone: 'amber', icon: 'key',
    help: 'The grey tick on their profile. Putting it on needs a reason, and it goes on the audit row.',
  },
  warn: {
    label: 'Private warning', tone: 'ghost', icon: 'chat',
    help: 'Lands in their notification bell, and their inbox unless they turned warning emails off. Always written to the record.',
  },
  clear_flags: {
    label: 'Clear spam flags', tone: 'primary', icon: 'refresh',
    help: 'Closes every open report on the account and its content and clears a sign-in lockout. It does not undo a takedown somebody decided.',
  },
  delete: {
    label: 'Delete account', tone: 'danger', icon: 'x',
    help: 'Destroys the account, their posts, comments, listings, follows, messages and wallet. Refused while anything is running or owed.',
  },
};

const ORDER: Verb[] = ['suspend', 'reinstate', 'warn', 'verify', 'clear_flags', 'delete'];

export default function PeoplePage() {
  const { status, noteGate, session } = useSession();
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [provider, setProvider] = useState('all');
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [facets, setFacets] = useState<PeopleFacets | null>(null);
  const [verbs, setVerbs] = useState<PersonVerbs>({ actions: false, warn: false });
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // The pen icons at the end of a row do not act on the spot — they open the
  // account with that one ask already written, so the reason and the audit row
  // are still typed by a person who can see who they are about to bar.
  const [askFor, setAskFor] = useState<Verb | null>(null);
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

  const done = (out: PersonOutcome) => {
    setBanner({ kind: 'ok', text: out.detail });
    // The account no longer exists, so the open card has nothing left to show.
    if (out.action === 'delete') { setOpen(null); setAskFor(null); }
    load();
  };

  const toggle = (username: string) => {
    setOpen(current => (current === username ? null : username));
    setAskFor(null);
  };

  const actOn = (username: string, verb: Verb) => {
    setOpen(username);
    setAskFor(verb);
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
          <h2>Nobody matches this view</h2>
          <p>
            Clear the search or pick another state. Every account that has ever finished signing up
            is here, including ones suspended or deactivated.
          </p>
        </section>
      ) : (
        <div className="grid-wrap">
          <table className="grid">
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
                opens={open === row.username} askFor={open === row.username ? askFor : null}
                onToggle={() => toggle(row.username)} onAct={verb => actOn(row.username, verb)}
                onDone={out => { done(out); if (out.action !== 'delete') setAskFor(null); }}
                noteGate={noteGate}
              />
            ))}
          </table>
        </div>
      )}

      <More hasMore={!!cursor} busy={busy} onMore={older} label="Load more accounts" />
    </ConsoleShell>
  );
}

function PersonRowView({
  row, verbs, mine, opens, askFor, onToggle, onAct, onDone, noteGate,
}: {
  row: PersonRow;
  verbs: PersonVerbs;
  mine: boolean;
  opens: boolean;
  askFor: Verb | null;
  onToggle: () => void;
  onAct: (verb: Verb) => void;
  onDone: (out: PersonOutcome) => void;
  noteGate: (err: unknown) => boolean;
}) {
  const holding = row.flags.on_account + row.flags.on_content;
  const barred = !!row.suspension;
  const offered: Verb[] = ['warn', barred ? 'reinstate' : 'suspend', 'delete'];

  return (
    <tbody className={`person${opens ? ' open' : ''}`} data-person={row.username}>
      <tr className={`grid-row${opens ? ' open' : ''}`}>
        <td>
          <button type="button" className="person-id" onClick={onToggle} aria-expanded={opens}>
            <span className="grid-caret">{IC.chevron}</span>
            <span className="id">@{row.username}</span>
          </button>
        </td>
        <td className="strong">
          <span className="person-name">
            {row.name}
            {row.verified && <span className="verified" title="Verified by staff">✓</span>}
          </span>
        </td>
        <td className="dim wrap">{row.email || '—'}</td>
        <td>{ROLE_LABEL[row.role] || row.role}</td>
        <td className="dim">joined {ago(row.joined)}</td>
        <td className="num">{num(row.posts)}</td>
        <td className="num">{num(row.followers)}</td>
        <td className="num" title="Wallet balance">{row.coins}</td>
        <td>
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
            {mine && <span className="pill mute">You</span>}
          </div>
        </td>
        <td>
          <span className={`state ${verbs.actions || verbs.warn ? 'good' : 'mute'}`}>
            {verbs.actions ? 'Full' : verbs.warn ? 'Warn only' : 'View only'}
          </span>
        </td>
        <td>
          <div className="grid-acts">
            <Act icon="eye" label={opens ? 'Close this account' : 'Open this account'} onClick={onToggle} />
            {offered.map(verb => (
              <Act
                key={verb}
                icon={verb === 'warn' ? 'pen' : verb === 'delete' ? 'trash' : barred ? 'check' : 'lock'}
                label={SPEC[verb].label}
                tone={verb === 'delete' ? 'dead' : undefined}
                disabled={!mine && !(verb === 'warn' ? verbs.warn : verbs.actions)}
                onClick={() => onAct(verb)}
              />
            ))}
          </div>
        </td>
      </tr>
      {opens && (
        <tr className="grid-detail">
          <td colSpan={11}>
            <PersonDetailCard
              username={row.username} verbs={verbs} mine={mine} askFor={askFor}
              onDone={onDone} noteGate={noteGate}
            />
          </td>
        </tr>
      )}
    </tbody>
  );
}

function PersonDetailCard({
  username, verbs, mine, askFor, onDone, noteGate,
}: {
  username: string;
  verbs: PersonVerbs;
  mine: boolean;
  askFor: Verb | null;
  onDone: (out: PersonOutcome) => void;
  noteGate: (err: unknown) => boolean;
}) {
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetail(await api<PersonDetail>(`admin/people/${username}/`));
      setError(null);
    } catch (err) {
      if (!noteGate(err)) setError((err as Error).message);
    }
  }, [noteGate, username]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!detail) {
    return error
      ? <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>
      : <div className="seat-body"><div className="skeleton-stack"><div className="skeleton"/><div className="skeleton"/></div></div>;
  }

  const person = detail.person;
  const offered = ORDER.filter(verb => {
    if (verb === 'reinstate') return !!person.suspension;
    if (verb === 'suspend') return !person.suspension;
    return true;
  });

  return (
    <div className="person-body">
      <div className="person-side">
        <h3>Act on this account</h3>
        {!verbs.actions && !verbs.warn ? (
          <p className="note">
            This seat may read the directory but holds neither <b>Suspend, reinstate, verify,
            delete</b> nor <b>Private warnings to users</b>, so there is nothing to sign here.
          </p>
        ) : (
          <div className="verbs">
            {offered.map(verb => {
              const needs = verb === 'warn' ? verbs.warn : verbs.actions;
              return (
                <VerbButton
                  key={verb} verb={verb} person={person} allowed={needs && !mine}
                  detail={detail} opened={askFor === verb}
                  onDone={out => { onDone(out); reload(); }}
                  noteGate={noteGate}
                />
              );
            })}
          </div>
        )}
        {mine && (
          <p className="note row">
            {IC.lock}
            <span>
              This is the account you are signed in with. Nothing can be suspended or deleted from
              the seat doing it, which is why the buttons are off.
            </span>
          </p>
        )}

        <h3>What a deletion would take</h3>
        <dl className="facts">
          <div><dt>Wallet</dt><dd>{detail.holdings.balance} coins</dd></div>
          <div><dt>Running campaigns</dt><dd>{detail.holdings.campaigns}</dd></div>
          <div><dt>Payment proofs waiting</dt><dd>{detail.holdings.pending_requests}</dd></div>
          <div><dt>Content</dt><dd>{detail.holdings.posts} posts, {detail.holdings.comments} comments, {detail.holdings.listings} listings</dd></div>
        </dl>
        {detail.ledger.length > 0 && (
          <p className="fineprint">
            Last ledger move: {detail.ledger[0].kind} {detail.ledger[0].amount} · {ago(detail.ledger[0].created_at)}
          </p>
        )}
      </div>

      <div className="person-record">
        <h3>The pile</h3>
        {detail.reports.length === 0 && detail.content.length === 0 ? (
          <p className="note">Nothing is reported against this account or anything it has posted.</p>
        ) : (
          <>
            <ul className="chips">
              {detail.content.slice(0, 12).map(item => (
                <li key={item.target} className="chip" data-pile={item.target}>
                  {item.target} · {item.state}
                  {item.open > 0 ? ` · ${item.open} open (${item.reporters} reporters)` : ''}
                </li>
              ))}
            </ul>
            <ul className="reporters">
              {detail.reports.slice(0, 6).map(report => (
                <li key={report.id}>
                  <b>{report.reason}</b>
                  <em>{report.reporter ? `@${report.reporter.username}` : 'unknown'} · {ago(report.created_at)} · {report.status}</em>
                  {report.details && <span className="ctext">{report.details}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>What staff have told them</h3>
        {detail.warnings.length === 0
          ? <p className="note">No private warnings on record.</p>
          : (
            <ul className="reporters">
              {detail.warnings.map((entry, index) => (
                // The notification has no id in this payload; who said it and when is unique enough.
                <li key={`${entry.created_at}-${index}`}>
                  <b>{entry.text}</b>
                  <em>{entry.actor ? `@${entry.actor}` : 'staff'} · {ago(entry.created_at)}</em>
                </li>
              ))}
            </ul>
          )}

        <h3>Record</h3>
        {detail.audit.length === 0
          ? <p className="note">No staff decision has touched this account yet.</p>
          : (
            <ul className="reporters">
              {detail.audit.slice(0, 10).map(entry => (
                <li key={entry.id}>
                  <b>{entry.action}</b>
                  <em title={stamp(entry.created_at)}>{entry.actor ? `@${entry.actor}` : 'system'} · {ago(entry.created_at)}</em>
                  <span className="ctext">{entry.detail}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

function VerbButton({
  verb, person, allowed, detail, opened, onDone, noteGate,
}: {
  verb: Verb;
  person: PersonRow;
  allowed: boolean;
  detail: PersonDetail;
  opened: boolean;
  onDone: (out: PersonOutcome) => void;
  noteGate: (err: unknown) => boolean;
}) {
  const [form, setForm] = useState(false);
  const [kind, setKind] = useState<'days' | 'until' | 'permanent'>('days');
  const [days, setDays] = useState('7');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pen clicked at the end of the row means "this one", so the ask opens
  // itself with the reason box already under the cursor.
  useEffect(() => {
    if (opened) { setForm(true); setError(null); }
  }, [opened]);

  const spec = SPEC[verb];
  const label = verb === 'verify'
    ? (person.verified ? 'Take the tick off' : 'Give the verified tick')
    : spec.label;

  const submit = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const out = await api<PersonOutcome>(PATH[verb](person.username), { method: 'POST', body });
      setForm(false);
      setReason('');
      setText('');
      setConfirm('');
      onDone(out);
    } catch (err) {
      // A lapsed admin window or an ended seat is the shell's business, not this card's error line.
      if (!noteGate(err)) setError((err as Error).message || 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    setError(null);
    if (verb === 'reinstate') {
      submit({});
      return;
    }
    setForm(!form);
  };

  const needsReason = verb === 'suspend' || verb === 'clear_flags'
    || (verb === 'verify' && !person.verified) || verb === 'delete';

  const canSend = (() => {
    if (verb === 'warn') return text.trim().length > 0;
    if (verb === 'delete') return reason.trim().length > 0 && confirm.trim() === person.username;
    if (verb === 'verify') return person.verified ? true : reason.trim().length > 0;
    if (verb === 'clear_flags') return reason.trim().length > 0;
    if (verb === 'suspend') return reason.trim().length > 0
      && (kind === 'permanent' || (kind === 'days' ? Number(days) >= 1 : until.length > 0));
    return true;
  })();

  const send = () => {
    if (verb === 'suspend') {
      submit(kind === 'permanent'
        ? { permanent: true, reason: reason.trim() }
        : kind === 'until'
          ? { until, reason: reason.trim() }
          : { days: Number(days), reason: reason.trim() });
      return;
    }
    if (verb === 'verify') {
      submit({ verified: !person.verified, reason: reason.trim() });
      setReason('');
      return;
    }
    if (verb === 'warn') {
      submit({ text: text.trim(), reason: reason.trim() });
      setText('');
      setReason('');
      return;
    }
    if (verb === 'clear_flags') {
      submit({ reason: reason.trim() });
      setReason('');
      return;
    }
    if (verb === 'delete') {
      submit({ reason: reason.trim(), confirm: confirm.trim() });
    }
  };

  return (
    <>
      <button
        type="button" data-verb={verb}
        className={`btn ${spec.tone} tiny`}
        disabled={busy || !allowed}
        title={allowed ? spec.help : `This seat does not hold ${verb === 'warn' ? 'Private warnings to users' : 'Suspend, reinstate, verify, delete'}`}
        onClick={start}
      >
        {IC[spec.icon]}
        <span>{busy && !form ? 'Working…' : label}</span>
      </button>

      {form && (
        <div className="ask">
          <p className="note row">{IC.alert}<span>{spec.help}</span></p>

          {verb === 'suspend' && (
            <div className="suspend-kind">
              <label className="field">
                <span>For how long</span>
                <select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
                  <option value="days">A number of days</option>
                  <option value="until">Until a date</option>
                  <option value="permanent">Permanently, until staff put it back</option>
                </select>
              </label>
              {kind === 'days' && (
                <label className="field">
                  <span>Days</span>
                  <input
                    type="number" min={1} max={3650} value={days}
                    onChange={event => setDays(event.target.value)} aria-label="Days of suspension"
                  />
                </label>
              )}
              {kind === 'until' && (
                <label className="field">
                  <span>Ends on</span>
                  <input type="date" value={until} onChange={event => setUntil(event.target.value)} aria-label="Suspension end date"/>
                </label>
              )}
              {kind === 'permanent' && (
                <p className="fineprint">
                  A permanent bar is the same column set far ahead, so only a reinstate lifts it.
                  The account keeps everything it has — suspending is not deleting.
                </p>
              )}
            </div>
          )}

          {verb === 'warn' && (
            <label className="field">
              <span>The warning they read</span>
              <textarea
                rows={3} name="warn_text" value={text} maxLength={240} autoFocus
                placeholder="e.g. Third harassment report. Do not post other people's photographs."
                onChange={event => setText(event.target.value)}
              />
            </label>
          )}

          {verb === 'delete' && (
            <>
              <p className="note row">
                {IC.alert}
                <span>
                  Deleting takes {detail.holdings.posts} post(s), {detail.holdings.comments} comment(s),{' '}
                  {detail.holdings.listings} listing(s) and their wallet with the ledger in it. It is
                  refused while a campaign runs, a payment proof waits, or the balance is not zero.
                </span>
              </p>
              <label className="field">
                <span>Type the username to confirm</span>
                <input
                  value={confirm} onChange={event => setConfirm(event.target.value)}
                  placeholder={person.username} autoComplete="off" aria-label="Type the username to confirm"
                />
              </label>
            </>
          )}

          {verb !== 'warn' && (
            <label className="field">
              <span>Reason {needsReason ? '— required, and kept on the record' : '(optional)'}</span>
              <textarea
                rows={2} name="reason" value={reason} maxLength={500}
                placeholder={verb === 'verify' && !person.verified
                  ? 'What made this account worth a tick'
                  : 'The sentence the audit row keeps'}
                onChange={event => setReason(event.target.value)}
              />
            </label>
          )}

          {verb === 'warn' && (
            <label className="field">
              <span>Reason (optional — written next to the warning)</span>
              <textarea rows={1} name="reason" value={reason} maxLength={240} onChange={event => setReason(event.target.value)}/>
            </label>
          )}

          <div className="ask-actions">
            <button type="button" className={`btn ${spec.tone} tiny`} disabled={busy || !canSend} onClick={send}>
              {IC.go}<span>{busy ? 'Working…' : `Confirm — ${label}`}</span>
            </button>
            <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => setForm(false)}>
              <span>Cancel</span>
            </button>
          </div>

          {error && <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>}
        </div>
      )}
    </>
  );
}
