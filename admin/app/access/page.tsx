'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { ActLink, Chips } from '@/components/List';
import { ROLE_LABEL, ScreenPicker, roleKeys } from '@/components/SeatDesk';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { useAdminEvent } from '@/lib/live';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { Catalogue, Seat } from '@/lib/types';

interface Banner {
  kind: 'ok' | 'bad';
  text: string;
}

/** The roster chips, named the way the seat's own status fields are keyed. */
const SEAT_STATES = [
  { id: 'all', label: 'Every seat' },
  { id: 'enabled', label: 'Active' },
  { id: 'revoked', label: 'Ended' },
  { id: 'unenrolled', label: 'No authenticator yet' },
];

export default function AccessPage() {
  const { can, isSuperadmin, session, noteGate } = useSession();
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);
  const [granting, setGranting] = useState(false);
  // The search box answers every keystroke, so three requests for one word can
  // land in any order, and the one that arrives last is not the one that was
  // typed last. Each call takes a number and only the newest may paint the roster.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (state !== 'all') params.set('status', state);
    const tail = params.toString();
    try {
      const data = await api<{ results: Seat[]; counts?: Record<string, number> }>(
        `admin/staff/${tail ? `?${tail}` : ''}`);
      if (seq.current !== mine) return;
      setSeats(data.results);
      setCounts(data.counts || null);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [q, state, noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  useAdminEvent(['audit'], load);

  useEffect(() => {
    api<Catalogue>('admin/permissions/')
      .then(setCatalogue)
      .catch(err => { if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message }); });
  }, [noteGate]);

  const labelOf = useCallback(
    (key: string) => catalogue?.permissions.find(entry => entry.key === key)?.label || key,
    [catalogue],
  );

  return (
    <ConsoleShell
      title="Staff and access"
      subtitle="Who may open the console, at which role, and which screens each seat actually reaches."
      actions={can('staff_grant') && (
        <button type="button" className="btn primary" onClick={() => setGranting(!granting)}>
          {IC.plus}<span>{granting ? 'Close' : 'Grant a seat'}</span>
        </button>
      )}
    >
      {granting && <GrantForm
        busy={busy} labelOf={labelOf} catalogue={catalogue}
        onDone={async text => { setGranting(false); setBanner({ kind: 'ok', text }); await load(); }}
        onError={err => setBanner({ kind: 'bad', text: (err as Error).message })}
        noteGate={noteGate}
      />}

      <Chips
        label="Filter seats" value={state} onPick={setState}
        chips={SEAT_STATES.map(item => ({ ...item, n: counts ? counts[item.id] : undefined }))}
      />

      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search by name, username or email" aria-label="Search staff"
          />
        </label>
        <button type="button" className="btn ghost" onClick={() => load()} title="Reload the roster">
          {IC.refresh}
        </button>
        <span className="toolbar-count">
          Admins: <b>{seats === null ? '…' : seats.length}</b>
        </span>
      </div>

      <Banner banner={banner} />

      {!seats ? (
        <div className="skeleton-stack">
          <div className="skeleton" /><div className="skeleton" /><div className="skeleton skeleton-short" />
        </div>
      ) : seats.length === 0 ? (
        <section className="panel empty">
          <h2>No seats match this view</h2>
          <p>Everyone with a staff account is listed here. Grant a seat to give a person access to the console.</p>
        </section>
      ) : (
        <div className="roster grid-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Seat</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th className="num">Screens</th>
                <th>Last sign-in</th>
                <th>Codes</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            {seats.map(seat => {
              const mine = seat.username === session?.user.username;
              const reachable = isSuperadmin || seat.role === 'moderator';
              const editable = can('staff_permissions') && reachable && !mine;
              return (
                <tbody key={seat.username} className="seat">
                  <tr className="grid-row">
                    <td data-label="Seat">
                      <Link href={`/access/${seat.username}`} className="seat-id">
                        <span className="grid-caret">{IC.chevron}</span>
                        <span className="id">@{seat.username}</span>
                      </Link>
                    </td>
                    <td data-label="Name" className="strong">{seat.name}</td>
                    <td data-label="Email" className="dim wrap">{seat.email || '-'}</td>
                    <td data-label="Role">{ROLE_LABEL[seat.role]}</td>
                    <td data-label="Screens" className="num">{seat.permissions.length}</td>
                    <td data-label="Last sign-in" className="dim">{ago(seat.last_admin_login_at)}</td>
                    <td data-label="Codes" className="num">{seat.recovery_left || '-'}</td>
                    <td data-label="Status">
                      <div className="seat-flags">
                        {seat.is_enabled
                          ? <span className="pill good">Active</span>
                          : <span className="pill dead">Access ended {ago(seat.revoked_at)}</span>}
                        {seat.enrolled
                          ? <span className="pill good">{IC.key}<span>Authenticator set</span></span>
                          : <span className="pill warn">{IC.alert}<span>No authenticator</span></span>}
                        {seat.must_change_password && (
                          <span className="pill warn">{IC.alert}<span>Password not their own yet</span></span>
                        )}
                        {!reachable && <span className="pill mute">Above your reach</span>}
                        {mine && <span className="pill mute">You</span>}
                      </div>
                    </td>
                    <td data-label="Actions">
                      <div className="grid-acts">
                        <ActLink to={`/access/${seat.username}`} icon="eye" label="Open this seat"/>
                        <ActLink
                          to={`/access/${seat.username}`} icon="pen"
                          label="Screens this seat reaches" disabled={!editable}
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </ConsoleShell>
  );
}
/**
 * Two ways to give somebody a seat.
 *
 * "New person" writes the account, the role and the first password in one go ,
 * what used to take a colleague signing up as a member first and being promoted
 * afterwards, under a username a spare account had already taken. "Existing
 * account" stays for the colleague who already joins as a member.
 *
 * In the new-person mode the password lives in two places and then nowhere: this
 * screen, and the letter posted to the address written here. The seat is flagged so
 * the door refuses that password a second time and makes the person choose their own
 * before a code is even asked for.
 */
function GrantForm({
  busy, catalogue, labelOf, onDone, onError, noteGate,
}: {
  busy: boolean;
  catalogue: Catalogue | null;
  labelOf: (key: string) => string;
  onDone: (text: string) => Promise<void>;
  onError: (err: unknown) => void;
  noteGate: (err: unknown) => boolean;
}) {
  const { isSuperadmin } = useSession();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [issued, setIssued] = useState('');
  const [role, setRole] = useState('moderator');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  // The role decides where the ticks start, and nothing more: switching it reseeds
  // the list, and the boxes can then be moved off that starting point by hand.
  const seed = useCallback(
    (which: string) => Object.fromEntries(roleKeys(catalogue, which).map(key => [key, true])),
    [catalogue],
  );
  useEffect(() => { setPicked(seed(role)); }, [role, seed]);
  const openCount = catalogue ? catalogue.permissions.filter(entry => picked[entry.key]).length : 0;

  const grant = async () => {
    const who = username.trim();
    const address = email.trim();
    if (!who) {
      onError(new Error(mode === 'new'
        ? 'Choose the username this person will sign in with.'
        : 'Type the username of an existing account.'));
      return;
    }
    if (mode === 'new' && issued.length < 8) {
      onError(new Error('Give a temporary password of at least 8 characters, or suggest one.'));
      return;
    }
    // The server refuses a seat with no address, because it is what staff sign in
    // with and the only way they get a lost password back. Say so before the write.
    if (mode === 'new' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      onError(new Error('Their email address is needed: it is what the new seat signs in with, and '
        + 'the letter holding the temporary password goes there.'));
      return;
    }
    const sure = await confirm(mode === 'new'
      ? {
        title: `Open a new ${ROLE_LABEL[role]} seat for ${name.trim() || '@' + who}?`,
        body: `This creates the account itself, not just a seat on it: the username becomes theirs, and ${address} gets a letter with the temporary password, the console link and the ${openCount} screen(s) this seat opens. Nobody, including you, can read that password back afterwards, so the letter is the copy that lasts.`,
        confirmLabel: 'Create the seat',
        tone: 'danger',
      }
      : {
        title: `Make @${who} a ${ROLE_LABEL[role]}?`,
        body: 'This turns a member account into staff. They can sign in to this console as soon as they set up an authenticator, and everything they do is written under their name. Superadmin seats can lock you out of this screen.',
        confirmLabel: 'Grant the seat',
        tone: 'danger',
      });
    if (!sure) return;
    try {
      const held = new Set(roleKeys(catalogue, role));
      const chosen = (catalogue?.permissions ?? []).filter(entry => picked[entry.key]).map(entry => entry.key);
      const granted = chosen.filter(key => !held.has(key));
      const denied = Array.from(held).filter(key => !chosen.includes(key));
      const out = await api<Seat & { detail?: string }>(mode === 'new' ? 'admin/staff/create/' : 'admin/staff/grant/', {
        method: 'POST',
        body: mode === 'new'
          ? {
            username: who, name: name.trim(), email: address, role, password: issued,
            granted_keys: granted, denied_keys: denied,
          }
          : { username: who, role, granted_keys: granted, denied_keys: denied },
      });
      await onDone(out.detail
        || (mode === 'new'
          ? `${who} holds a ${ROLE_LABEL[role]} seat with ${openCount} screens. Their password and the console link went to ${address}.`
          : `${who} now holds a ${ROLE_LABEL[role]} seat.`));
    } catch (err) {
      if (!noteGate(err)) onError(err);
    }
  };

  return (
    <section className="panel grant">
      <h2>Give somebody a seat</h2>
      <Chips
        label="Who is getting the seat" value={mode} onPick={value => setMode(value as 'new' | 'existing')}
        chips={[
          { id: 'new', label: 'A new staff account' },
          { id: 'existing', label: 'An account that exists' },
        ]}
      />
      {mode === 'new' ? (
        <p className="note">
          No account needed first. The username is reserved here, the password below is the one they
          sign in with the first time, and it is posted to their email along with the console link and
          the screens they open. The door makes them choose their own password before it opens.
        </p>
      ) : (
        <p className="note">
          For a colleague who already joins as a member. The account keeps its own password; giving
          it a seat only makes the person staff.
        </p>
      )}
      <div className="grant-row">
        {mode === 'new' && (
          <label className="field grow">
            <span>Their name</span>
            <input
              value={name} onChange={event => setName(event.target.value)}
              placeholder="Sita Maharjan" autoComplete="off"
            />
          </label>
        )}
        <label className="field grow">
          <span>{mode === 'new' ? 'New username' : 'Username'}</span>
          <input
            value={username} onChange={event => setUsername(event.target.value)}
            placeholder={mode === 'new' ? 'sita.m' : 'existing username'} autoComplete="off"
          />
        </label>
        {mode === 'new' && (
          <label className="field grow">
            <span>Email <em className="fineprint">*</em></span>
            <input
              type="email" value={email} onChange={event => setEmail(event.target.value)}
              placeholder="sita@company.com" autoComplete="off"
            />
          </label>
        )}
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={event => setRole(event.target.value)}>
            {(isSuperadmin ? ['superadmin', 'admin', 'moderator'] : ['moderator'])
              .map(value => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
          </select>
        </label>
      </div>
      {mode === 'new' && (
        <div className="grant-row">
          <label className="field grow">
            <span>Temporary password <em className="fineprint">*</em></span>
            <input
              value={issued} onChange={event => setIssued(event.target.value)}
              placeholder="At least 8 characters" autoComplete="new-password" spellCheck={false}
            />
          </label>
          <button
            type="button" className="btn ghost" title="Write a random one, it goes in their letter"
            onClick={() => setIssued(issuedPassword())}
          >
            {IC.refresh}<span>Suggest one</span>
          </button>
        </div>
      )}
      {role === 'superadmin' ? (
        <p className="note">A Superadmin is the Client and opens every screen, so there is nothing to tick.</p>
      ) : (
        <div className="grant-screens">
          <div className="grant-screens-head">
            <h3>Screens they can open</h3>
            <p>
              Tick what this person should reach. A {ROLE_LABEL[role]} starts with the screens that
              role always gets, marked below; anything you tick extra or untick is written on top of
              that. A seat that ticks nothing opens the console and no screens.
            </p>
          </div>
          <ScreenPicker
            catalogue={catalogue} role={role} checked={picked} labelOf={labelOf}
            onToggle={key => setPicked({ ...picked, [key]: !picked[key] })}
            onSetAll={kind => {
              if (kind === 'role') setPicked(seed(role));
              else if (kind === 'none') setPicked({});
              else setPicked(Object.fromEntries(
                (catalogue?.permissions ?? []).map(entry => [entry.key, true]),
              ));
            }}
          />
        </div>
      )}
      <div className="grant-row grant-send">
        <button type="button" className="btn primary" disabled={busy} onClick={grant}>
          {IC.check}<span>{mode === 'new' ? 'Create the seat' : 'Give access'}</span>
        </button>
        <span className="fineprint">
          {mode === 'new' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
            ? `The sign-in, the password and these ${openCount} screens are posted to ${email.trim()}.`
            : `${openCount} screen(s) will be open to this seat.`}
        </span>
      </div>
    </section>
  );
}

/**
 * A password a seat can be read over the phone: no look-alike characters, no
 * punctuation that a chat app eats, and long enough to pass the platform's own
 * checks without being a string the person will never type again.
 */
function issuedPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}
