'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { pushListRow, threadFragment, useList } from '@/lib/lists';
import { merge as applyFragment } from '@/lib/store';
import { mapMessage } from '@/lib/dto';
import { Message, User } from '@/lib/types';

function dayStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * One thread, addressed by the other person. It is the whole chat screen on
 * phones and the right pane of the desktop messenger, and the read receipt,
 * history paging and scroll anchoring have to behave the same in both.
 */
export default function ChatThread({ other }: { other: User }) {
  const router = useRouter();
  const { db, me, t, setDb, markThreadRead, sendMessage, serverMode } = useApp();
  const lang = db.lang;
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchor = useRef<number | null>(null);

  const meId = me?.id;
  const otherId = other.id;

  // Server pages land in the cache; the thread itself is always the pair's
  // messages in time order, so a message typed a second ago sits where it sent.
  const page = threadFragment(meId || '', otherId);
  const stream = useList(
    `thread:${otherId}`,
    { path: `/messages/${other.username}/`, frag: page },
    undefined,
    serverMode && !!me,
  );

  const thread = useMemo<Message[]>(() => {
    if (!meId) return [];
    return db.messages
      .filter(m => (m.from === meId && m.to === otherId) || (m.from === otherId && m.to === meId))
      .sort((a, b) => a.ts - b.ts);
  }, [db.messages, meId, otherId]);

  // Opening the thread is the read receipt — for every message in it, not just
  // the page this screen loaded, so the server decides what the receipt covers.
  useEffect(() => {
    if (!meId) return;
    void markThreadRead(other.username);
  }, [meId, other, markThreadRead]);

  // Receipts and replies arrive while the thread sits open: a quiet poll of the
  // newest page refreshes the ticks without ever touching the scroll anchor.
  const reloadRef = useRef(stream.reload);
  reloadRef.current = stream.reload;
  useEffect(() => {
    if (!serverMode || !meId) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadRef.current();
    }, 6000);
    return () => clearInterval(id);
  }, [serverMode, meId]);

  // The live wire for this thread: incoming messages, typing and read receipts
  // land instantly instead of waiting for the poll. Same cookie auth as the
  // REST API, same first-party proxy, exponential reconnect when it drops.
  const markReadRef = useRef(markThreadRead);
  markReadRef.current = markThreadRead;
  const wsRef = useRef<WebSocket | null>(null);
  const typingSent = useRef(0);
  useEffect(() => {
    if (!serverMode || !meId || !otherId) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let attempts = 0;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSeen = Date.now();

    const connect = () => {
      if (stopped || socket) return;
      const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/chat/${other.username}/`);
      socket = ws;
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        lastSeen = Date.now();
      };
      ws.onmessage = ev => {
        lastSeen = Date.now();
        let data: any;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (data.kind === 'message') {
          const mapped = mapMessage(data.message, meId, otherId);
          setDb(prev => applyFragment(prev, { messages: [mapped] }));
          pushListRow(`thread:${otherId}`, undefined, mapped.id);
          // The thread is open, so an incoming row is read as it lands.
          if (mapped.from !== meId) void markReadRef.current(other.username);
        } else if (data.kind === 'typing') {
          setTyping(true);
          if (typingTimer) clearTimeout(typingTimer);
          typingTimer = setTimeout(() => setTyping(false), 3000);
        } else if (data.kind === 'read') {
          setDb(prev => ({
            ...prev,
            messages: prev.messages.map(m => (m.from === meId && m.to === otherId && m.status !== 'read'
              ? { ...m, status: 'read' as const, read: true }
              : m)),
          }));
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        if (socket === ws) { socket = null; wsRef.current = null; }
        attempts += 1;
        reconnect = setTimeout(connect, Math.min(1000 * 2 ** attempts, 15000));
      };
    };

    // A ping keeps the proxies from idling the socket out; the watchdog cuts
    // off a peer that stopped answering, and onclose walks the backoff.
    heartbeat = setInterval(() => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'ping' }));
      if (Date.now() - lastSeen > 45000) socket.close();
    }, 25000);

    connect();
    return () => {
      stopped = true;
      if (reconnect) clearTimeout(reconnect);
      if (heartbeat) clearInterval(heartbeat);
      if (typingTimer) clearTimeout(typingTimer);
      if (socket) { socket.onclose = null; socket.close(); }
      wsRef.current = null;
    };
  }, [serverMode, meId, otherId, other.username, setDb]);

  // Only a new message — or a different conversation — pulls the reader to the
  // foot of the thread; rows added above stay exactly where they were.
  const newest = thread.length ? thread[thread.length - 1].id : '';
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest, otherId]);

  const loadOlder = async () => {
    const el = threadRef.current;
    anchor.current = el ? el.scrollHeight - el.scrollTop : null;
    await stream.loadMore();
    if (anchor.current !== null) {
      const node = threadRef.current;
      if (node) node.scrollTop = node.scrollHeight - anchor.current;
      anchor.current = null;
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!me || !text.trim()) return;
    void sendMessage(other.id, text);
    setText('');
    inputRef.current?.focus();
  };

  // Typing is a tell, not a telegraph: at most one frame every two seconds.
  const noteTyping = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - typingSent.current > 2000) {
      typingSent.current = Date.now();
      ws.send(JSON.stringify({ type: 'typing' }));
    }
  };

  const todayStart = dayStart(Date.now());
  let lastDay = 0;
  // The skeleton is only for a thread with nothing cached yet; a poll reload
  // passes through loaded=false and must not blank a thread already on screen.
  const opening = serverMode && !stream.loaded && thread.length === 0;

  return (
    <div className="chat-view">
      <header className="detail-header chat-header">
        <button type="button" className="icon-btn chat-back" aria-label={t('back')} onClick={() => router.push('/messages')}>{IC.back}</button>
        <button type="button" className="chat-header-id" onClick={() => router.push(`/u/${other.username}`)}>
          <Avatar user={other} size={38} />
          <span className="chat-header-copy">
            <b>{other.name}{other.verified && <VerifiedBadge />}</b>
            <span>@{other.username}</span>
          </span>
        </button>
        <span className="detail-header-spacer" />
      </header>

      <div className="chat-thread" ref={threadRef}>
        {serverMode && (
          <div className="chat-older">
            {stream.error
              ? <button type="button" className="chat-older-btn" onClick={() => void stream.reload()}>{t('retry')}</button>
              : stream.hasMore && !opening
                ? <button type="button" className="chat-older-btn" disabled={stream.loading} onClick={loadOlder}>↑ {t('loadMore')}</button>
                : null}
          </div>
        )}
        {opening ? (
          <div className="chat-skeleton" aria-hidden="true">
            <span className="sk-lines"><i /><i /></span>
            <span className="sk-lines right"><i /></span>
            <span className="sk-lines"><i /><i /></span>
          </div>
        ) : thread.length === 0 ? (
          <div className="chat-intro">
            <Avatar user={other} size={76} />
            <b>{other.name}{other.verified && <VerifiedBadge />}</b>
            <span>@{other.username}</span>
            <button type="button" className="chat-wave" onClick={() => sendMessage(other.id, '👋')}>
              <span aria-hidden>👋</span>{t('sayHi')}
            </button>
          </div>
        ) : thread.map(m => {
          const day = dayStart(m.ts);
          const separator = day !== lastDay;
          lastDay = day;
          const mine = m.from === me?.id;
          // Rows without a server status (seeded or pre-upgrade) read off `read`.
          const receipt = mine ? m.status || (m.read ? 'read' : 'delivered') : null;
          return (
            <div key={m.id} className="chat-turn">
              {separator && (
                <div className="chat-day">
                  {day === todayStart
                    ? t('today')
                    : new Date(day).toLocaleDateString(lang === 'ne' ? 'ne-NP' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
              <div className={`chat-bubble-row ${mine ? 'mine' : 'theirs'}`}>
                {!mine && <Avatar user={other} size={28} />}
                <div className={`chat-bubble ${mine ? 'mine' : 'theirs'}`}>
                  <p>{m.text}</p>
                  <span className="chat-meta">
                    {ago(m.ts, lang)}
                    {receipt && <span className={`chat-receipt ${receipt}`}>{receipt === 'sent' ? '✓' : '✓✓'}</span>}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form className="chat-compose" onSubmit={submit}>
        <input
          ref={inputRef}
          value={text}
          onChange={e => { setText(e.target.value); noteTyping(); }}
          placeholder={t('typeMessage')}
          aria-label={t('typeMessage')}
          maxLength={2000}
          autoComplete="off"
        />
        <button type="submit" className="chat-send" disabled={!text.trim()} aria-label={t('send')}>{IC.send}</button>
      </form>
      {typing && (
        <div className="chat-typing" aria-hidden="true">
          <span /><span /><span />
          <em>{t('typing')}</em>
        </div>
      )}
    </div>
  );
}
