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
 * The inbox the messages screen and the top-bar popover both need: one row per
 * thread, newest activity first, and below them the people you follow but have
 * never written to — the band that starts a chat. A thread someone just wrote
 * in therefore sits at the head of the column on both ends of the conversation,
 * so nobody scrolls past a wall of names to find the message. The band is
 * one-way — following someone puts them in your inbox; their inbox only learns
 * of you when you send a message or they follow you back — and its newest follow
 * leads it.
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
    // When the follow happened is the only moment a suggested row has, so the
    // band is ordered by it: the person followed a second ago leads the section.
    const followedAt = new Map<string, number>();
    for (const edge of db.follows) {
      if (edge.follower !== me.id || edge.status === 'pending') continue;
      if ((followedAt.get(edge.following) ?? 0) < edge.ts) followedAt.set(edge.following, edge.ts);
    }
    const byFollow = (a: Conversation, b: Conversation) =>
      (followedAt.get(b.other.id) ?? 0) - (followedAt.get(a.other.id) ?? 0)
      || a.other.name.localeCompare(b.other.name);

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
      // would resurface as a suggestion beside the threads.
      const hidden = new Set(db.hiddenConversations || []);
      const blocked = new Set(db.blocks || []);
      // The place the server gave each row, kept as the last tie-break so a
      // re-render cannot shuffle equal moments.
      const order = new Map(inbox.ids.map((id, i) => [id, i]));
      const rows = inbox.ids
        .map(id => {
          const other = db.users.find(u => u.id === id);
          const message = last.get(id) || null;
          return other ? { other, last: message, unread: message?.unread ?? 0 } : null;
        })
        .filter((c): c is Conversation => !!c)
        // Newest activity decides who sits at the head, and the cache already
        // holds that moment for every row the column read — the inbox card
        // carries its last message. Waiting for the server's order instead means
        // a thread only moves when something re-pulls it, and the one wire that
        // always lands a message first, the bell, adds the row before that pull
        // finishes. So a row with no moment yet is a thread that just appeared:
        // it takes the head, which is exactly what a new message is.
        .sort((a, b) => {
          if (!!a.last !== !!b.last) return a.last ? 1 : -1;
          return (b.last?.ts ?? 0) - (a.last?.ts ?? 0)
            || (order.get(a.other.id) ?? 0) - (order.get(b.other.id) ?? 0);
        });
      const fresh = inbox.loaded
        ? followedIds()
            .filter(id => !talked.has(id) && !hidden.has(id) && !blocked.has(id))
            .map(id => db.users.find(u => u.id === id))
            .filter((u): u is User => !!u)
            .map(other => ({ other, last: null, unread: 0, suggested: true }))
            .sort(byFollow)
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
    const hiddenIds = new Set(db.hiddenConversations || []);
    byOther.forEach((msgs, otherId) => {
      const other = db.users.find(u => u.id === otherId);
      if (!other) return;
      if ((db.blocks || []).includes(otherId)) return;
      msgs.sort((a, b) => a.ts - b.ts);
      out.push({ other, last: msgs[msgs.length - 1], unread: msgs.filter(m => m.to === me.id && !m.read).length });
    });
    for (const id of followedIds()) {
      // A thread deleted on this device is not a suggestion waiting to be read
      // again: the band stays quiet until a message actually crosses.
      if (byOther.has(id) || hiddenIds.has(id)) continue;
      const other = db.users.find(u => u.id === id);
      if (other) out.push({ other, last: null, unread: 0, suggested: true });
    }
    // One order for both builds: threads by activity at the head, then the band,
    // newest follow first.
    const threads = out.filter(c => !c.suggested)
      .sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0) || a.other.name.localeCompare(b.other.name));
    return [...threads, ...out.filter(c => c.suggested).sort(byFollow)];
  }, [db.messages, db.users, db.follows, db.blocks, db.hiddenConversations, me, inbox.ids, serverMode]);

  return { conversations, inbox };
}
