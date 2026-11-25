'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { CYCLE, ROLE_LABEL, SeatBody, State } from '@/components/SeatDesk';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { Catalogue, Seat } from '@/lib/types';

/**
 * One seat on its own page. The roster row answers "who is staff and what can
 * they open"; this is where a role, a screen or a door is actually signed, and
 * it is far enough from the list that a scroll cannot carry it away mid-click.
 */
export default function SeatPage({ params }: { params: { username: string } }) {
  const { can, isSuperadmin, session, noteGate } = useSession();
  const [seat, setSeat] = useState<Seat | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, State>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const username = params.username;

  const load = useCallback(async () => {
    try {
      const data = await api<{ results: Seat[] }>(`admin/staff/?q=${encodeURIComponent(username)}`);
      const found = data.results.find(entry => entry.username === username) || null;
      setSeat(found);
      setMissing(found ? null : 'There is no staff account with that username. It may have never been given a seat.');
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate, username]);

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

  const valueOf = useCallback((key: string): State => {
    if (key in draft) return draft[key];
    if (!seat) return 'default';
    if (seat.denied_keys.includes(key)) return 'deny';
    if (seat.granted_keys.includes(key)) return 'allow';
    return 'default';
  }, [draft, seat]);

  const draftKeys = useMemo(() => {
    if (!catalogue || !seat) return { granted: [] as string[], denied: [] as string[] };
    const granted: string[] = [];
    const denied: string[] = [];
    catalogue.permissions.forEach(entry => {
      const value = valueOf(entry.key);
      if (value === 'allow') granted.push(entry.key);
      if (value === 'deny') denied.push(entry.key);
    });
    return { granted: granted.sort(), denied: denied.sort() };
  }, [catalogue, seat, valueOf]);

  const dirty = !!seat && (
    JSON.stringify(draftKeys.granted) !== JSON.stringify([...seat.granted_keys].sort())
    || JSON.stringify(draftKeys.denied) !== JSON.stringify([...seat.denied_keys].sort())
  );

  const mine = seat?.username === session?.user.username;
  const reachable = !!seat && (isSuperadmin || seat.role === 'moderator');
  const editable = can('staff_permissions') && reachable && !mine;

  return (
    <ConsoleShell
      title={seat ? `@${seat.username}, ${seat.name}` : `@${username}`}
      subtitle={seat
        ? `${ROLE_LABEL[seat.role] || seat.role} seat · ${seat.permissions.length} screens · last in ${ago(seat.last_admin_login_at)}`
        : 'What this seat is, which screens it reaches, and what can be signed onto it.'}
      actions={(
        <>
          <Link href="/access" className="btn ghost">{IC.chevron}<span>All seats</span></Link>
          <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={load} title="Reload this seat">
            {IC.refresh}<span>Refresh</span>
          </button>
        </>
      )}
    >
      <Banner banner={banner} />

      {!seat && !missing && (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      )}

      {missing && (
        <section className="panel empty">
          <h2>This seat is not here</h2>
          <p>{missing}</p>
        </section>
      )}

      {seat && (
        <SeatBody
          seat={seat} mine={!!mine} reachable={reachable} editable={editable}
          busy={busy} can={can} isSuperadmin={isSuperadmin}
          catalogue={catalogue} labelOf={labelOf} valueOf={valueOf}
          draftKeys={draftKeys} dirty={dirty}
          onCycle={key => setDraft({ ...draft, [key]: CYCLE[valueOf(key)] })}
          onSave={() => mutate(`admin/staff/${seat.username}/`,
            { granted_keys: draftKeys.granted, denied_keys: draftKeys.denied },
            `Saved ${seat.username}'s screens. The change lands on their next click, no new code needed.`)}
          onDiscard={() => setDraft({})}
          onMutate={mutate}
        />
      )}
    </ConsoleShell>
  );
}
