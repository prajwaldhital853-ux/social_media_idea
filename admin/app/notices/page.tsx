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

const PEN: Record<string, string> = {
  post: 'Post and comment review',
  comment: 'Post and comment review',
  listing: 'Marketplace listing review',
  user: 'Report queue',
};

/**
 * The hand-written notice. A decision in the queue still writes one as a side
 * effect, but contract 6.5 says a notice is only ever added or removed through
 * this dashboard — so the desk needs its own way of saying it, for the claim
 * that nobody reported.
 */
function AttachDesk({ busy, onDone }: {
  busy: boolean;
  onDone: (banner: { kind: 'ok' | 'bad'; text: string }) => void;
}) {
  const [kind, setKind] = useState('post');
  const [ident, setIdent] = useState('');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const { noteGate } = useSession();

  const ready = ident.trim() !== '' && text.trim() !== '' && reason.trim() !== '';

  const send = async () => {
    setSending(true);
    try {
      const out = await api<{ detail?: string }>('admin/notices/attach/', {
        method: 'POST',
        body: { target: `${kind}:${ident.trim()}`, text: text.trim(), reason: reason.trim() },
      });
      setText('');
      setReason('');
      onDone({ kind: 'ok', text: out.detail || 'The notice is standing.' });
    } catch (err) {
      if (!noteGate(err)) onDone({ kind: 'bad', text: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel" data-attach="notice">
      <div className="panel-head">
        <div>
          <h2>Put a notice on content</h2>
          <p>
            The sentence goes over the post, comment, listing or account it names and everyone
            reading that content sees it. Nobody but this desk can put one up or take one down.
          </p>
        </div>
      </div>

      <div className="ask">
        <div className="term-add">
          <label className="field">
            <span>What it goes on</span>
            <select value={kind} onChange={event => setKind(event.target.value)} aria-label="What the notice goes on">
              {TARGETS.filter(item => item.id).map(item => (
                <option key={item.id} value={item.id}>{item.label.replace('About a ', 'A ')}</option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Its number</span>
            <input
              name="id" value={ident} maxLength={12} autoComplete="off" aria-label="Content id"
              placeholder="5815 — the number at the end of the address bar"
              onChange={event => setIdent(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
        </div>

        <label className="field">
          <span>The sentence the community reads <em>{text.length}/240</em></span>
          <textarea
            name="text" rows={2} value={text} maxLength={240}
            placeholder="This claim has been checked and is false."
            onChange={event => setText(event.target.value)}
          />
        </label>

        <label className="field">
          <span>Why it is going up</span>
          <input
            name="reason" value={reason} maxLength={120} autoComplete="off" aria-label="Why the notice goes up"
            placeholder="misinformation — the health claim has no source"
            onChange={event => setReason(event.target.value)}
          />
        </label>

        <div className="ask-actions">
          <button
            type="button" className="btn primary" disabled={busy || sending || !ready} onClick={send}
            title={ready ? 'Put this notice on the content' : 'The sentence and the reason are both needed'}
          >
            {IC.mega}<span>{sending ? 'Working…' : 'Put the notice up'}</span>
          </button>
        </div>

        <p className="note">
          Writing about a {kind === 'user' ? 'n account' : kind} also needs
          <b> {PEN[kind]}</b> on the seat, and the number is the one in the address bar.
        </p>
      </div>
    </section>
  );
}

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

      <AttachDesk busy={busy} onDone={next => {
        setBanner(next);
        if (next.kind === 'ok') load();
      }}/>

      <p className="note row">
        {IC.mega}
        <span>
          The same sentence is also written by the <b>Public notice</b> decision on the report queue
          and the takedown shelf. A notice is the half the community sees; the author gets a private
          warning in their own bell as well, and that is sent from the account itself.
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
            Nothing has been said to the community about content on this platform yet. Write the
            first sentence above, or make a decision with the Public notice verb on the queue.
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
