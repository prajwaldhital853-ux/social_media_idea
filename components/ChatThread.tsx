'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { api } from '@/lib/api';
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

/** A shared link is either the site's own post/reel or somewhere off-site. */
function shareTarget(url: string): { path: string; postId: string; index: number } | null {
  let path = '';
  try { path = new URL(url).pathname; } catch { return null; }
  const post = path.match(/^\/post\/([^/?#]+)/);
  if (post) return { path, postId: decodeURIComponent(post[1]), index: 0 };
  const reel = path.match(/^\/video\/([^/?#]+)/);
  if (reel) {
    const key = decodeURIComponent(reel[1]);
    const cut = key.lastIndexOf('-');
    const index = cut > 0 ? Number(key.slice(cut + 1)) : 0;
    return { path, postId: cut > 0 ? key.slice(0, cut) : key, index: Number.isFinite(index) ? index : 0 };
  }
  return null;
}

/** Message text with its links live rather than as coloured plain words. */
function MessageText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>;
        const target = shareTarget(part);
        const label = part.replace(/^https?:\/\//, '');
        return target
          ? <Link key={i} className="chat-link" href={target.path}>{label}</Link>
          : <a key={i} className="chat-link" href={part} target="_blank" rel="noopener noreferrer">{label}</a>;
      })}
    </p>
  );
}

/**
 * The card under a shared link. The post is usually already in the cache because
 * the reader was looking at the thread it was sent from; a person who opens the
 * chat cold pulls the row by id once, and keeps the plain link if it is gone.
 */
function ShareCard({ path, postId, index }: { path: string; postId: string; index: number }) {
  const { db, loadEntity } = useApp();
  const [asked, setAsked] = useState(false);
  const post = db.posts.find(p => p.id === postId);

  useEffect(() => {
    if (post || asked) return;
    setAsked(true);
    void loadEntity('post', postId);
  }, [post, asked, postId, loadEntity]);

  if (!post) return null;
  const media = post.media[index] || post.media[0];
  const art = media ? media.src || media.gen || '' : '';
  const author = db.users.find(u => u.id === post.uid);
  const host = typeof window === 'undefined' ? '' : window.location.host;

  return (
    <Link href={path} className="chat-link-card">
      <span className="chat-link-art">
        {art
          ? media?.type === 'video'
            ? <video src={art} muted playsInline preload="metadata" />
            : <img src={art} alt="" loading="lazy" />
          : IC.video}
      </span>
      <span className="chat-link-copy">
        <b>{author ? author.name || author.username : 'Exposing'}</b>
        <small>{post.text}</small>
        <em>{host}</em>
      </span>
    </Link>
  );
}

/**
 * One thread, addressed by the other person. It is the whole chat screen on
 * phones and the right pane of the desktop messenger, and the read receipt,
 * history paging and scroll anchoring have to behave the same in both.
 *
 * `seed` is a sentence the reader arrived with — an advert's "Message now"
 * button writes the question so the first thing they do is send it, not invent
 * it. It fills the composer; it never sends anything by itself.
 */
export default function ChatThread({ other, seed }: { other: User; seed?: string }) {
  const router = useRouter();
  const { db, me, t, setDb, markThreadRead, sendMessage, serverMode } = useApp();
  const lang = db.lang;
  const [text, setText] = useState(seed || '');
  const [typing, setTyping] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    if (!seed) return;
    setText(seed);
    inputRef.current?.focus();
  }, [seed]);

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
  // Keyed on the handle, never on the `other` object: marking read refreshes
  // the inbox, the inbox rebuilds every person card in the cache, and a new
  // object for the same person would fire this effect again forever.
  const otherName = other.username;
  useEffect(() => {
    if (!meId) return;
    void markThreadRead(otherName);
  }, [meId, otherName, markThreadRead]);

  // Receipts and replies arrive while the thread sits open. The poll is the last
  // of the three wires and runs only while neither live one is holding the
  // thread, so a quiet conversation costs a page now and then, not a tick.
  const reloadRef = useRef(stream.reload);
  reloadRef.current = stream.reload;
  const wires = useRef({ stream: false, socket: false });
  useEffect(() => {
    if (!serverMode || !meId) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (wires.current.stream || wires.current.socket) return;
      void reloadRef.current();
    }, 5000);
    return () => clearInterval(id);
  }, [serverMode, meId]);

  // Three frames, one shape, two wires: whatever arrives lands the same way no
  // matter which transport carried it, because both are trusted and neither alone.
  const markReadRef = useRef(markThreadRead);
  markReadRef.current = markThreadRead;
  const typingFade = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sink = useRef({
    message: (_row: any) => {},
    receipt: (_state: 'delivered' | 'read') => {},
    typing: () => {},
  });

  sink.current.message = (row: any) => {
    if (!meId) return;
    const mapped = mapMessage(row, meId, otherId);
    setDb(prev => applyFragment(prev, { messages: [mapped] }));
    pushListRow(`thread:${otherId}`, undefined, mapped.id);
    // The inbox holds a row for anybody the thread has a message for — including
    // the person written to for the first time a second ago, whose conversation
    // did not exist when the column was read.
    pushListRow('inbox', undefined, otherId);
    // The thread is open, so an incoming row is read as it lands.
    // force is required: dbRef still holds the pre-message db here.
    if (mapped.from !== meId) void markReadRef.current(other.username, { force: true });
  };

  sink.current.receipt = state => {
    const rank = { sent: 0, delivered: 1, read: 2 };
    setDb(prev => ({
      ...prev,
      messages: prev.messages.map(m => {
        if (!meId || m.from !== meId || m.to !== otherId) return m;
        const now = rank[m.status || (m.read ? 'read' : 'sent')];
        if (rank[state] <= now) return m;
        return { ...m, status: state, read: state === 'read' ? true : m.read };
      }),
    }));
  };

  sink.current.typing = () => {
    setTyping(true);
    if (typingFade.current) clearTimeout(typingFade.current);
    typingFade.current = setTimeout(() => setTyping(false), 3000);
  };

  // The event stream is the wire every proxy carries: the same first-party
  // request as the rest of the API, one row a second after it is written.
  useEffect(() => {
    if (!serverMode || !meId || !otherId) return;
    let es: EventSource | null = null;
    let stopped = false;
    let again: ReturnType<typeof setTimeout> | null = null;
    let delay = 2000;
    // Kept across a drop: the server resumes the thread from this row, so a
    // stream that blinked for two seconds does not skip the message in between.
    let lastId = '';

    const open = () => {
      if (stopped || es || document.visibilityState !== 'visible') return;
      es = new EventSource(
        `/api/messages/${other.username}/stream/${lastId ? `?last_event_id=${encodeURIComponent(lastId)}` : ''}`,
      );
      const source = es;
      source.addEventListener('open', () => {
        delay = 2000;
        wires.current.stream = true;
      });
      source.addEventListener('chat', ev => {
        const event = ev as MessageEvent;
        if (event.lastEventId) lastId = event.lastEventId;
        try { sink.current.message(JSON.parse(event.data).message); } catch { /* a frame that is not a row is not a message */ }
      });
      source.addEventListener('receipt', ev => {
        try { sink.current.receipt(JSON.parse((ev as MessageEvent).data).state); } catch { /* ignore */ }
      });
      source.addEventListener('typing', () => sink.current.typing());
      source.addEventListener('error', () => {
        if (es !== source) return;
        source.close();
        es = null;
        wires.current.stream = false;
        if (stopped) return;
        again = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30000);
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (es) { es.close(); es = null; }
        wires.current.stream = false;
      } else {
        open();
      }
    };

    open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (again) clearTimeout(again);
      if (es) es.close();
      wires.current.stream = false;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [serverMode, meId, otherId, other.username]);

  // The socket is the faster wire where a proxy carries the upgrade. Three
  // handshakes that never complete is a hop that will never make one, so it stops
  // trying rather than filling the server log all day — the stream has the thread.
  const wsRef = useRef<WebSocket | null>(null);
  const typingSent = useRef(0);
  useEffect(() => {
    if (!serverMode || !meId || !otherId) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let attempts = 0;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let lastSeen = Date.now();

    const connect = () => {
      if (stopped || socket) return;
      const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws/chat/${other.username}/`);
      socket = ws;
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        lastSeen = Date.now();
        wires.current.socket = true;
      };
      ws.onmessage = ev => {
        lastSeen = Date.now();
        let data: any;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (data.kind === 'message') sink.current.message(data.message);
        else if (data.kind === 'typing') sink.current.typing();
        else if (data.kind === 'read') sink.current.receipt('read');
      };
      ws.onclose = () => {
        wires.current.socket = false;
        if (stopped) return;
        if (socket === ws) { socket = null; wsRef.current = null; }
        attempts += 1;
        if (attempts >= 3) return;
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
      wires.current.socket = false;
      if (reconnect) clearTimeout(reconnect);
      if (heartbeat) clearInterval(heartbeat);
      if (socket) { socket.onclose = null; socket.close(); }
      wsRef.current = null;
    };
  }, [serverMode, meId, otherId, other.username]);

  useEffect(() => () => {
    if (typingFade.current) clearTimeout(typingFade.current);
  }, []);

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

  // Typing is a tell, not a telegraph: at most one frame every two seconds, and
  // only down a wire that is already answering. A dead socket gets no POST — the
  // request would only be a second thing failing while the thread is quiet.
  const noteTyping = () => {
    if (Date.now() - typingSent.current < 2000) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      typingSent.current = Date.now();
      ws.send(JSON.stringify({ type: 'typing' }));
      return;
    }
    if (!wires.current.stream) return;
    typingSent.current = Date.now();
    void api.post(`/api/messages/${other.username}/typing/`, {}).catch(() => {});
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
          const linked = m.text.match(/https?:\/\/[^\s]+/);
          const shared = linked ? shareTarget(linked[0]) : null;
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
                  <MessageText text={m.text} />
                  {shared && <ShareCard path={shared.path} postId={shared.postId} index={shared.index} />}
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
