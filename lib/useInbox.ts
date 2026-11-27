'use client';

import { useMemo } from 'react';
import { useApp } from './AppContext';
import { inboxListDef, useList } from './lists';
import { Message, User } from './types';

export interface Conversation {
  other: User;
  last: Message | null;
  unread: number;
  /** I follow them but we have never spoken — the band above the conversations. */
  suggested?: boolean;
}

/**
 * The inbox the messages screen and the top-bar popover both need: the people
 * you follow but have not written to as one band on top, then one row per
 * thread, newest activity first. The band is one-way — following someone puts
 * them in your inbox; their inbox only learns of you when you send a message
 * or they follow you back.
 */
export function useInbox(enabled = true): { conversations: Conversation[]; inbox: ReturnType<typeof useList> } {
  const { db, me, followedIds, serverMode } = useApp();

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
      const talked = new Set(inbox.ids);
      // The server's list already left blocked pairs and threads I deleted out;
      // the band has to agree with it, or a followed person the server skipped
      // would resurface as a suggestion above the threads.
      const hidden = new Set(db.hiddenConversations || []);
      const blocked = new Set(db.blocks || []);
      const rows = inbox.ids
        .map(id => {
          const other = db.users.find(u => u.id === id);
          const message = last.get(id) || null;
          return other ? { other, last: message, unread: message?.unread ?? 0 } : null;
        })
        .filter((c): c is Conversation => !!c)
        // Newest activity decides who sits at the head, and the cache already
        // holds that moment for every row the column read. Waiting for the
        // server's order instead means a thread only moves when something
        // re-pulls it — and the one wire that always lands a message first, the
        // open thread, suppresses the bell that would have asked.
        .sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0));
      const fresh = inbox.loaded
        ? followedIds()
            .filter(id => !talked.has(id) && !hidden.has(id) && !blocked.has(id))
            .map(id => db.users.find(u => u.id === id))
            .filter((u): u is User => !!u)
            .map(other => ({ other, last: null, unread: 0, suggested: true }))
            .sort((a, b) => a.other.name.localeCompare(b.other.name))
        : [];
      return [...fresh, ...rows];
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
      if ((db.blocks || []).includes(otherId)) return;
      msgs.sort((a, b) => a.ts - b.ts);
      out.push({ other, last: msgs[msgs.length - 1], unread: msgs.filter(m => m.to === me.id && !m.read).length });
    });
    for (const id of followedIds()) {
      if (byOther.has(id)) continue;
      const other = db.users.find(u => u.id === id);
      if (other) out.push({ other, last: null, unread: 0, suggested: true });
    }
    // One order for both builds: the band above the threads, threads by activity.
    return out.sort((a, b) => Number(!!b.suggested) - Number(!!a.suggested)
      || (b.last?.ts ?? 0) - (a.last?.ts ?? 0) || a.other.name.localeCompare(b.other.name));
  }, [db.messages, db.users, db.follows, db.blocks, db.hiddenConversations, me, inbox.ids, serverMode]);

  return { conversations, inbox };
}
