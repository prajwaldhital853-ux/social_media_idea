'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { ActLink, Chips } from '@/components/List';
import { CYCLE, KeyGrid, ROLE_LABEL, State } from '@/components/SeatDesk';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { Catalogue, Seat } from '@/lib/types';

interface Banner {
  kind: 'ok' | 'bad';
  text: string;
}

export default function AccessPage() {
  const { can, isSuperadmin, session, noteGate } = useSession();
  const [seats, setSeats] = useState<Seat[] | null>(null);
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
      const data = await api<{ results: Seat[] }>(`admin/staff/${tail ? `?${tail}` : ''}`);
      if (seq.current !== mine) return;
      setSeats(data.results);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [q, state, noteGate]);

  useEffect(() => {
    load();
  }, [load]);

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
        chips={[
          { id: 'all', label: 'Every seat' },
          { id: 'enabled', label: 'Active' },
          { id: 'revoked', label: 'Ended' },
          { id: 'unenrolled', label: 'No authenticator yet' },
        ]}
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
                    <td>
                      <Link href={`/access/${seat.username}`} className="seat-id">
                        <span className="grid-caret">{IC.chevron}</span>
                        <span className="id">@{seat.username}</span>
                      </Link>
                    </td>
                    <td className="strong">{seat.name}</td>
                    <td className="dim wrap">{seat.email || '—'}</td>
                    <td>{ROLE_LABEL[seat.role]}</td>
                    <td className="num">{seat.permissions.length}</td>
                    <td className="dim">{ago(seat.last_admin_login_at)}</td>
                    <td className="num">{seat.recovery_left || '—'}</td>
                    <td>
                      <div className="seat-flags">
                        {seat.is_enabled
                          ? <span className="pill good">Active</span>
                          : <span className="pill dead">Access ended {ago(seat.revoked_at)}</span>}
                        {seat.enrolled
                          ? <span className="pill good">{IC.key}<span>Authenticator set</span></span>
                          : <span className="pill warn">{IC.alert}<span>No authenticator</span></span>}
                        {!reachable && <span className="pill mute">Above your reach</span>}
                        {mine && <span className="pill mute">You</span>}
                      </div>
                    </td>
                    <td>
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
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('moderator');
  const [extra, setExtra] = useState<Record<string, State>>({});

  const grant = async () => {
    if (!username.trim()) {
      onError(new Error('Type the username of an existing account.'));
      return;
    }
    const sure = await confirm({
      title: `Make @${username.trim()} a ${ROLE_LABEL[role]}?`,
      body: 'This turns a member account into staff. They can sign in to this console as soon as they set up an authenticator, and everything they do is written under their name. Superadmin seats can lock you out of this screen.',
      confirmLabel: 'Grant the seat',
      tone: 'danger',
    });
    if (!sure) return;
    try {
      const granted = Object.entries(extra).filter(([, value]) => value === 'allow').map(([key]) => key);
      const denied = Object.entries(extra).filter(([, value]) => value === 'deny').map(([key]) => key);
      await api<Seat>('admin/staff/grant/', {
        method: 'POST',
        body: { username: username.trim(), role, granted_keys: granted, denied_keys: denied },
      });
      await onDone(`${username.trim()} now holds a ${ROLE_LABEL[role]} seat.`);
    } catch (err) {
      if (!noteGate(err)) onError(err);
    }
  };

  return (
    <section className="panel grant">
      <h2>Grant a seat</h2>
      <p className="note">
        The account must already exist on the platform. Giving it a seat makes the person staff,
        and the next sign-in still needs an authenticator they set up themselves.
      </p>
      <div className="grant-row">
        <label className="field grow">
          <span>Username</span>
          <input
            value={username} onChange={event => setUsername(event.target.value)}
            placeholder="existing username" autoComplete="off"
          />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={event => setRole(event.target.value)}>
            {(isSuperadmin ? ['superadmin', 'admin', 'moderator'] : ['moderator'])
              .map(value => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={busy} onClick={grant}>
          {IC.check}<span>Give access</span>
        </button>
      </div>
      {role !== 'superadmin' && catalogue && (
        <KeyGrid
          catalogue={catalogue} labelOf={labelOf}
          valueOf={key => extra[key] || 'default'}
          onChange={key => setExtra({ ...extra, [key]: CYCLE[extra[key] || 'default'] })}
        />
      )}
      {role === 'superadmin' && (
        <p className="note">A Superadmin holds every screen, so there is nothing to add here.</p>
      )}
    </section>
  );
}
