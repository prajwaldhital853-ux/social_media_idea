'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import { Act, Chips } from '@/components/List';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { Catalogue, Seat } from '@/lib/types';

type State = 'default' | 'allow' | 'deny';
const CYCLE: Record<State, State> = { default: 'allow', allow: 'deny', deny: 'default' };
const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', moderator: 'Moderator',
};

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
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, State>>({});
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

  const mutate = useCallback(async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setBanner(null);
    try {
      await api(path, { method: 'POST', body });
      setBanner({ kind: 'ok', text: done });
      await load();
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [load, noteGate]);

  const expand = (seat: Seat) => {
    if (open === seat.username) {
      setOpen(null);
      setDraft({});
      return;
    }
    setOpen(seat.username);
    // Only the clicks are remembered. What the seat actually holds is read from
    // the roster row every time, so nothing here depends on load order.
    setDraft({});
  };

  const current = useMemo(
    () => (seats || []).find(seat => seat.username === open) || null,
    [seats, open],
  );

  const valueOf = useCallback((key: string): State => {
    if (draft && key in draft) return draft[key];
    if (!current) return 'default';
    if (current.denied_keys.includes(key)) return 'deny';
    if (current.granted_keys.includes(key)) return 'allow';
    return 'default';
  }, [draft, current]);

  const draftKeys = useMemo(() => {
    if (!catalogue || !current) return { granted: [] as string[], denied: [] as string[] };
    const granted: string[] = [];
    const denied: string[] = [];
    catalogue.permissions.forEach(entry => {
      const value = valueOf(entry.key);
      if (value === 'allow') granted.push(entry.key);
      if (value === 'deny') denied.push(entry.key);
    });
    return { granted: granted.sort(), denied: denied.sort() };
  }, [catalogue, current, valueOf]);

  const dirty = !!current && (
    JSON.stringify(draftKeys.granted) !== JSON.stringify([...current.granted_keys].sort())
    || JSON.stringify(draftKeys.denied) !== JSON.stringify([...current.denied_keys].sort())
  );

  const saveKeys = () => {
    const username = open!;
    return mutate(`admin/staff/${username}/`,
      { granted_keys: draftKeys.granted, denied_keys: draftKeys.denied },
      `Saved ${username}'s screens. The change lands on their next click — no new code needed.`);
  };

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

      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

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
              const opens = open === seat.username;
              return (
                <tbody key={seat.username} className={`seat ${opens ? 'open' : ''}`}>
                  <tr className={`grid-row${opens ? ' open' : ''}`}>
                    <td>
                      <button type="button" className="seat-id" onClick={() => expand(seat)} aria-expanded={opens}>
                        <span className="grid-caret">{IC.chevron}</span>
                        <span className="id">@{seat.username}</span>
                      </button>
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
                        <Act icon="eye" label={opens ? 'Close this seat' : 'Open this seat'} onClick={() => expand(seat)} />
                        <Act
                          icon="pen" label="Screens this seat reaches"
                          disabled={!editable} onClick={() => !opens && expand(seat)}
                        />
                        <Act
                          icon="logout" label="End this seat's access" tone="dead"
                          disabled={!can('staff_grant') || !reachable || !seat.is_enabled || mine}
                          onClick={() => {
                            if (!window.confirm(`End ${seat.username}'s access to the console? Their sessions are revoked immediately.`)) return;
                            mutate(`admin/staff/${seat.username}/revoke/`, {}, `Access ended for ${seat.username}.`);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                  {opens && (
                    <tr className="grid-detail">
                      <td colSpan={9}>
                        <SeatBody
                          seat={seat} mine={mine} reachable={reachable} editable={editable}
                          busy={busy} can={can} isSuperadmin={isSuperadmin}
                          catalogue={catalogue} labelOf={labelOf} valueOf={valueOf}
                          draftKeys={draftKeys} dirty={dirty}
                          onCycle={key => setDraft({ ...draft, [key]: CYCLE[valueOf(key)] })}
                          onSave={saveKeys} onDiscard={() => setDraft({})} onMutate={mutate}
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </ConsoleShell>
  );
}

function SeatBody({
  seat, mine, reachable, editable, busy, can, isSuperadmin, catalogue, labelOf,
  valueOf, draftKeys, dirty, onCycle, onSave, onDiscard, onMutate,
}: {
  seat: Seat;
  mine: boolean;
  reachable: boolean;
  editable: boolean;
  busy: boolean;
  can: (key: string) => boolean;
  isSuperadmin: boolean;
  catalogue: Catalogue | null;
  labelOf: (key: string) => string;
  valueOf: (key: string) => State;
  draftKeys: { granted: string[]; denied: string[] };
  dirty: boolean;
  onCycle: (key: string) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onMutate: (path: string, body: Record<string, unknown>, done: string) => Promise<void>;
}) {
  return (
    <div className="seat-body">
      <div className="seat-side">
        <h3>Seat</h3>
        {seat.granted_by && (
          <p className="note">Granted by <b>{seat.granted_by}</b>.</p>
        )}
        {mine && (
          <p className="note">
            Your own role and screens are changed from another staff account — one bad
            click cannot shut the door you are standing in.
          </p>
        )}

        {editable && (
          <label className="field">
            <span>Role</span>
            <select
              defaultValue={seat.role}
              disabled={busy || seat.role === 'superadmin'}
              onChange={event => onMutate(`admin/staff/${seat.username}/`,
                { role: event.target.value },
                `${seat.username} is now a ${ROLE_LABEL[event.target.value]}.`)}
            >
              {(isSuperadmin ? ['superadmin', 'admin', 'moderator'] : ['moderator'])
                .map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </select>
            {seat.role === 'superadmin' && (
              <em>A Client seat holds every screen; there is nothing to narrow it to.</em>
            )}
          </label>
        )}

        {can('staff_permissions') && reachable && (
          <button
            type="button"
            className={`btn ${seat.is_enabled ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={() => onMutate(`admin/staff/${seat.username}/`, { is_enabled: !seat.is_enabled },
              seat.is_enabled
                ? `${seat.username}'s seat is switched off. Their open console stops at the next click.`
                : `${seat.username} can sign in again.`)}
          >
            {seat.is_enabled ? IC.x : IC.check}
            <span>{seat.is_enabled ? 'Switch seat off' : 'Switch seat back on'}</span>
          </button>
        )}

        {can('staff_permissions') && reachable && seat.enrolled && (
          <button
            type="button" className="btn ghost" disabled={busy}
            onClick={() => onMutate(`admin/staff/${seat.username}/reset-two-factor/`, {},
              `${seat.username}'s authenticator is unbound. They must scan a new one at the next sign-in.`)}
          >
            {IC.refresh}<span>Reset authenticator</span>
          </button>
        )}

        {can('staff_grant') && reachable && seat.is_enabled && !mine && (
          <button
            type="button" className="btn danger outline" disabled={busy}
            onClick={() => {
              if (!window.confirm(`End ${seat.username}'s access to the console? Their sessions are revoked immediately.`)) return;
              onMutate(`admin/staff/${seat.username}/revoke/`, {},
                `Access ended for ${seat.username}.`);
            }}
          >
            {IC.logout}<span>Revoke access</span>
          </button>
        )}

        {!seat.is_enabled && can('staff_grant') && reachable && (
          <button
            type="button" className="btn ghost" disabled={busy}
            onClick={() => onMutate('admin/staff/grant/',
              { username: seat.username, role: seat.role },
              `${seat.username} holds a ${ROLE_LABEL[seat.role]} seat again.`)}
          >
            {IC.plus}<span>Hand the same seat back</span>
          </button>
        )}
      </div>

      <div className="seat-keys">
        <h3>Screens</h3>
        {seat.role === 'superadmin' ? (
          <p className="note">A Superadmin is the Client and holds all {seat.permissions.length} screens.</p>
        ) : !editable ? (
          <div className="key-list">
            {seat.permissions.map(key => (
              <span key={key} className="key on">{labelOf(key)}</span>
            ))}
            {seat.permissions.length === 0 && <p className="note">This seat opens nothing but the console itself.</p>}
          </div>
        ) : (
          <>
            <p className="note">
              Click a screen to cycle role default → extra grant → explicit denial. A
              denial always wins, so a screen taken away stays taken away.
            </p>
            <KeyGrid
              catalogue={catalogue} valueOf={valueOf} labelOf={labelOf}
              onChange={onCycle}
            />
            <div className="key-actions">
              <button type="button" className="btn primary" disabled={busy || !dirty} onClick={onSave}>
                {IC.check}<span>Save screens</span>
              </button>
              <button
                type="button" className="btn ghost" disabled={busy || !dirty}
                onClick={onDiscard}
              >
                <span>Discard changes</span>
              </button>
              <span className="key-tally">
                {draftKeys.granted.length} granted · {draftKeys.denied.length} denied
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KeyGrid({
  catalogue, valueOf, labelOf, onChange,
}: {
  catalogue: Catalogue | null;
  valueOf: (key: string) => State;
  labelOf: (key: string) => string;
  onChange: (key: string) => void;
}) {
  if (!catalogue) return <div className="skeleton-stack"><div className="skeleton" /></div>;
  return (
    <div className="key-groups">
      {catalogue.groups.map(group => {
        const entries = catalogue.permissions.filter(entry => entry.group === group.id);
        if (entries.length === 0) return null;
        return (
          <div key={group.id} className="key-group">
            <span className="key-group-label">{group.label}</span>
            <div className="key-list">
              {entries.map(entry => {
                const value = valueOf(entry.key);
                return (
                  <button
                    type="button" key={entry.key}
                    className={`key ${value}`} onClick={() => onChange(entry.key)}
                    title={`Role default: ${entry.roles.map(role => ROLE_LABEL[role] || role).join(', ') || 'nobody'}`}
                  >
                    {value === 'allow' ? IC.plus : value === 'deny' ? IC.x : IC.check}
                    <span>{labelOf(entry.key)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
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
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('moderator');
  const [extra, setExtra] = useState<Record<string, State>>({});

  const grant = async () => {
    if (!username.trim()) {
      onError(new Error('Type the username of an existing account.'));
      return;
    }
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
