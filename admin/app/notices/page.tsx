'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import { api } from '@/lib/api';
import { IC } from '@/lib/icons';
import { ago, stamp } from '@/lib/time';
import { useSession } from '@/lib/session';
import { ContentKind, NoticePage, NoticeRow } from '@/lib/types';

const TARGETS: { id: ContentKind | ''; label: string }[] = [
  { id: '', label: 'Every notice' },
  { id: 'post', label: 'About a post' },
  { id: 'comment', label: 'About a comment' },
  { id: 'listing', label: 'About a listing' },
  { id: 'user', label: 'About an account' },
];

export default function NoticesPage() {
  const { noteGate } = useSession();
  const [rows, setRows] = useState<NoticeRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState('');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The search box answers every keystroke, so three requests for one word can
  // land in any order, and the one that arrives last is not the one that was
  // typed last. Each call takes a number and only the newest may paint the list.
  const seq = useRef(0);

  const fetchPage = useCallback(async (after: string | null) => {
    const params = new URLSearchParams();
    if (target) params.set('target', target);
    if (q.trim()) params.set('q', q.trim());
    if (after) params.set('cursor', after);
    return api<NoticePage>(`admin/notices/${params.toString() ? `?${params}` : ''}`);
  }, [q, target]);

  const load = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setBusy(true);
    try {
      const page = await fetchPage(null);
      if (seq.current !== mine) return;
      setRows(page.results);
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
      // A search typed while this was in flight owns the list now, so its answer
      // is the one that gets painted and these older rows are dropped.
      if (seq.current !== mine) return;
      setRows(list => [...(list || []), ...page.results]);
      setCursor(page.next_cursor);
    } catch (err) {
      if (seq.current !== mine) return;
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      if (seq.current === mine) setBusy(false);
    }
  };

  const withdraw = async (notice: NoticeRow) => {
    if (!window.confirm('Take this notice down? It stays on the record, marked withdrawn.')) return;
    setBusy(true);
    setBanner(null);
    try {
      await api(`admin/notices/${notice.id}/withdraw/`, { method: 'POST', body: {} });
      setBanner({ kind: 'ok', text: `The notice about @${notice.about} is withdrawn. The audit row says who took it down.` });
      await load();
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const live = (rows || []).filter(row => row.is_live).length;

  return (
    <ConsoleShell
      title="Public warning notices"
      subtitle="What the community has been told about a piece of content or an account — the sentence, who wrote it, and whether it is still standing."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the notices">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <div className="toolbar">
        <label className="search">
          {IC.search}
          <input
            value={q} onChange={event => setQ(event.target.value)}
            placeholder="Search the notice text, the person or the target id" aria-label="Search notices"
          />
        </label>
        <select value={target} onChange={event => setTarget(event.target.value)} aria-label="Filter by what it is about">
          {TARGETS.map(item => <option key={item.label} value={item.id}>{item.label}</option>)}
        </select>
        <span className="toolbar-count">{rows === null ? '…' : `${live} standing of ${rows.length} shown`}</span>
      </div>

      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

      <p className="note row">
        {IC.mega}
        <span>
          A notice is written by the <b>Public notice</b> decision on the report queue or the
          takedown shelf. The author also receives a private warning in their own bell; this screen
          is only the half the community sees.
        </span>
      </p>

      {rows === null ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : rows.length === 0 ? (
        <section className="panel empty">
          <h2>No notices</h2>
          <p>
            Nothing has been said to the community about content on this platform yet. A notice
            appears the moment a decision is made with the Public notice verb.
          </p>
        </section>
      ) : (
        <div className="notices">
          {rows.map(row => (
            <article key={row.id} data-notice={row.id} data-target={row.target} className={`notice${row.is_live ? '' : ' gone'}`}>
              <p className="notice-text">{row.text}</p>
              <div className="notice-meta">
                <span className="who">
                  <span className="who-name">
                    <b>@{row.about}</b>
                    <em>{row.target}</em>
                  </span>
                </span>
                <span>written by <b>{row.actor || 'the system'}</b> {ago(row.created_at)}</span>
                <span title={stamp(row.created_at)}>{new Date(row.created_at).toLocaleDateString()}</span>
                {row.is_live
                  ? <span className="pill warn">Standing</span>
                  : <span className="pill mute">Withdrawn {ago(row.withdrawn_at)}</span>}
              </div>
              {row.reason && <p className="notice-reason">Reason on file: {row.reason}</p>}
              {row.is_live && (
                <div className="notice-act">
                  <button type="button" className="btn danger outline tiny" disabled={busy} onClick={() => withdraw(row)}>
                    {IC.x}<span>Withdraw notice</span>
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {cursor && (
        <button type="button" className="btn ghost wide" disabled={busy} onClick={older}>
          {IC.go}<span>Show older</span>
        </button>
      )}
    </ConsoleShell>
  );
}
