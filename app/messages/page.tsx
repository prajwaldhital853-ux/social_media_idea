'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import ThemeToggle from '@/components/ThemeToggle';
import PeoplePicker from '@/components/PeoplePicker';
import { useApp } from '@/lib/AppContext';
import { useWindowed } from '@/lib/useWindowed';
import { closeLayerWithoutBack } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { Message, User } from '@/lib/types';

interface Conversation {
  other: User;
  last: Message | null;
  unread: number;
}

export default function MessagesPage() {
  const router = useRouter();
  const { db, me, t, mutualIds } = useApp();
  const lang = db.lang;
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(false);

  const conversations = useMemo<Conversation[]>(() => {
    if (!me) return [];
    const byOther = new Map<string, Message[]>();
    for (const m of db.messages) {
      if (m.from !== me.id && m.to !== me.id) continue;
      const otherId = m.from === me.id ? m.to : m.from;
      const list = byOther.get(otherId) || [];
      list.push(m);
      byOther.set(otherId, list);
    }
    const out: Conversation[] = [];
    byOther.forEach((msgs, otherId) => {
      const other = db.users.find(u => u.id === otherId);
      if (!other) return;
      msgs.sort((a, b) => a.ts - b.ts);
      out.push({
        other,
        last: msgs[msgs.length - 1],
        unread: msgs.filter(m => m.to === me.id && !m.read).length
      });
    });
    for (const id of mutualIds()) {
      if (byOther.has(id)) continue;
      const other = db.users.find(u => u.id === id);
      if (other) out.push({ other, last: null, unread: 0 });
    }
    return out.sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0) || a.other.name.localeCompare(b.other.name));
  }, [db.messages, db.users, db.follows, me]);

  const needle = q.trim().toLowerCase();
  const shown = conversations.filter(c =>
    !needle || c.other.name.toLowerCase().includes(needle) || c.other.username.toLowerCase().includes(needle)
  );
  const { limit, pending, sentinel, hasMore } = useWindowed(shown.length, 10, needle);
  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);

  return <AppShell>
    <div className="inbox-view">
      <header className="header home-header">
        <div className="home-header-row">
          <div className="home-header-copy">
            <h1 className="header-title">{t('messages')}</h1>
            <p className="header-sub">{totalUnread > 0 ? `${totalUnread} ${t('unread')}` : t('inbox')}</p>
          </div>
          <div className="header-actions">
            {me && (
              <button type="button" className="ghost-btn" onClick={() => setPicker(true)}>
                {IC.plus}<span>{t('newMessage')}</span>
              </button>
            )}
            <ThemeToggle compact/>
          </div>
        </div>
      </header>

      {!me ? (
        <div className="empty-state">
          <span className="empty-state-icon">{IC.msg}</span>
          <h2>{t('needLogin')}</h2>
          <button type="button" className="empty-state-cta" onClick={() => router.push('/login')}>{t('signIn')}</button>
        </div>
      ) : (
        <>
          <div className="inbox-search">
            {IC.search}
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('searchPeople')}
              aria-label={t('searchPeople')}
            />
          </div>
          {shown.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">{IC.msg}</span>
              <h2>{t('noMessages')}</h2>
              <button type="button" className="empty-state-cta" onClick={() => setPicker(true)}>{t('newMessage')}</button>
            </div>
          ) : (
            <div className="inbox-list">
              {shown.slice(0, limit).map(c => (
                <button
                  type="button"
                  key={c.other.id}
                  className={`inbox-row ${c.unread ? 'unread' : ''}`}
                  onClick={() => router.push(`/messages/${c.other.id}`)}
                >
                  <Avatar user={c.other} size={52}/>
                  <span className="inbox-row-main">
                    <span className="inbox-row-top">
                      <b>{c.other.name}{c.other.verified && <VerifiedBadge/>}</b>
                      {c.last && <span className="inbox-row-time">{ago(c.last.ts, lang)}</span>}
                    </span>
                    <span className={`inbox-row-preview ${c.last ? '' : 'hint'}`}>
                      {c.last ? `${c.last.from === me.id ? `${t('you')}: ` : ''}${c.last.text}` : t('mutualHint')}
                    </span>
                  </span>
                  {c.unread > 0 && <span className="inbox-badge">{c.unread}</span>}
                </button>
              ))}
              {pending && hasMore && (
                <div className="people-skeleton inbox" aria-hidden="true">
                  <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
                </div>
              )}
              {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
            </div>
          )}
        </>
      )}

      {picker && me && (
        <PeoplePicker
          title={t('newMessage')}
          exclude={[me.id]}
          onClose={() => setPicker(false)}
          onSelect={u => { closeLayerWithoutBack(); setPicker(false); router.push(`/messages/${u.id}`); }}
        />
      )}
    </div>
  </AppShell>;
}