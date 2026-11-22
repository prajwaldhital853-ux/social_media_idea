'use client';

import { useMemo } from 'react';
import { useApp } from './AppContext';
import { inboxListDef, useList } from './lists';
import { Message, User } from './types';

export interface Conversation {
  other: User;
  last: Message | null;
  unread: number;
}

/**
 * The inbox the messages screen and the top-bar popover both need: one row per
 * thread, newest activity first, and the mutuals you have never written to kept
 * below the real conversations so a fresh match is still one tap away.
 */
export function useInbox(enabled = true): { conversations: Conversation[]; inbox: ReturnType<typeof useList> } {
  const { db, me, mutualIds, serverMode } = useApp();

  const inbox = useList(
    'inbox',
    inboxListDef(me?.id || ''),
    undefined,
    serverMode && !!me && enabled,
  );

  const conversations = useMemo<Conversation[]>(() => {
    if (!me) return [];
    if (serverMode) {
      // The server picks and orders the threads; the cache only supplies the
      // last message of each row and the unread count that rode in with it.
      const last = new Map<string, Message>();
      for (const m of db.messages) {
        if (m.from !== me.id && m.to !== me.id) continue;
        const otherId = m.from === me.id ? m.to : m.from;
        const current = last.get(otherId);
        if (!current || m.ts >= current.ts) last.set(otherId, m);
      }
      // Mutuals you have never written to are the tail of the inbox, and only
      // once the real threads have arrived: before that they would sit on top
      // of a list that is about to appear above them.
      const talked = new Set(inbox.ids);
      const rows = inbox.ids
        .map(id => {
          const other = db.users.find(u => u.id === id);
          const message = last.get(id) || null;
          return other ? { other, last: message, unread: message?.unread ?? 0 } : null;
        })
        .filter((c): c is Conversation => !!c);
      const fresh = inbox.loaded
        ? mutualIds()
            .filter(id => !talked.has(id))
            .map(id => db.users.find(u => u.id === id))
            .filter((u): u is User => !!u)
            .map(other => ({ other, last: null, unread: 0 }))
            .sort((a, b) => a.other.name.localeCompare(b.other.name))
        : [];
      return [...rows, ...fresh];
    }
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
      out.push({ other, last: msgs[msgs.length - 1], unread: msgs.filter(m => m.to === me.id && !m.read).length });
    });
    for (const id of mutualIds()) {
      if (byOther.has(id)) continue;
      const other = db.users.find(u => u.id === id);
      if (other) out.push({ other, last: null, unread: 0 });
    }
    return out.sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0) || a.other.name.localeCompare(b.other.name));
  }, [db.messages, db.users, db.follows, me, inbox.ids, serverMode]);

  return { conversations, inbox };
}
