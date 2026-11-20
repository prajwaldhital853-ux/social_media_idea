'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { Message } from '@/lib/types';

function dayStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, setDb, sendMessage } = useApp();
  const lang = db.lang;
  const [text, setText] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const other = db.users.find(u => u.id === params.uid);
  const otherId = other?.id;
  const meId = me?.id;

  const thread = useMemo<Message[]>(() => {
    if (!meId || !otherId) return [];
    return db.messages
      .filter(m => (m.from === meId && m.to === otherId) || (m.from === otherId && m.to === meId))
      .sort((a, b) => a.ts - b.ts);
  }, [db.messages, meId, otherId]);

  useEffect(() => {
    if (!meId || !otherId) return;
    const hasUnread = db.messages.some(m => m.from === otherId && m.to === meId && !m.read);
    if (!hasUnread) return;
    setDb(prev => ({
      ...prev,
      messages: prev.messages.map(m => m.from === otherId && m.to === meId && !m.read ? { ...m, read: true } : m)
    }));
  }, [db.messages, meId, otherId, setDb]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, otherId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!other || !text.trim()) return;
    sendMessage(other.id, text);
    setText('');
    inputRef.current?.focus();
  };

  if (!me) {
    return <AppShell>
      <div className="empty-state">
        <span className="empty-state-icon">{IC.msg}</span>
        <h2>{t('needLogin')}</h2>
        <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
      </div>
    </AppShell>;
  }

  if (!other) {
    return <AppShell>
      <header className="detail-header">
        <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => router.push('/messages')}>{IC.back}</button>
        <h1>{t('messages')}</h1>
        <span className="detail-header-spacer"/>
      </header>
      <p className="feed-empty">{t('noUser')}</p>
    </AppShell>;
  }

  const todayStart = dayStart(Date.now());
  let lastDay = 0;

  return <AppShell>
    <div className="chat-view">
      <header className="detail-header chat-header">
        <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => router.push('/messages')}>{IC.back}</button>
        <button type="button" className="chat-header-id" onClick={() => router.push(`/u/${other.username}`)}>
          <Avatar user={other} size={38}/>
          <span className="chat-header-copy">
            <b>{other.name}{other.verified && <VerifiedBadge/>}</b>
            <span>@{other.username}</span>
          </span>
        </button>
        <span className="detail-header-spacer"/>
      </header>

      <div className="chat-thread" ref={threadRef}>
        {thread.length === 0 ? (
          <div className="chat-intro">
            <Avatar user={other} size={76}/>
            <b>{other.name}{other.verified && <VerifiedBadge/>}</b>
            <span>@{other.username}</span>
            <button type="button" className="chat-wave" onClick={() => sendMessage(other.id, '👋')}>
              <span aria-hidden>👋</span>{t('sayHi')}
            </button>
          </div>
        ) : thread.map(m => {
          const day = dayStart(m.ts);
          const separator = day !== lastDay;
          lastDay = day;
          const mine = m.from === me.id;
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
                {!mine && <Avatar user={other} size={28}/>}
                <div className={`chat-bubble ${mine ? 'mine' : 'theirs'}`}>
                  <p>{m.text}</p>
                  <span className="chat-meta">
                    {ago(m.ts, lang)}
                    {mine && <span className={`chat-receipt ${m.read ? 'read' : ''}`}>{m.read ? '✓✓' : '✓'}</span>}
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
          onChange={e => setText(e.target.value)}
          placeholder={t('typeMessage')}
          aria-label={t('typeMessage')}
          maxLength={2000}
          autoComplete="off"
        />
        <button type="submit" className="chat-send" disabled={!text.trim()} aria-label={t('send')}>{IC.send}</button>
      </form>
    </div>
  </AppShell>;
}