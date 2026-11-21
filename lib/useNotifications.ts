'use client';

import { useMemo } from 'react';
import { useApp } from './AppContext';
import { notificationsFragment, useList } from './lists';
import { Notification } from './types';

/**
 * The activity list the notifications screen and the top-bar popover share.
 * The server decides the order and the cursor; the popover simply asks for less
 * of it, so one fetch feeds both views.
 */
export function useNotifications(enabled = true): {
  rows: Notification[];
  unread: number;
  feed: ReturnType<typeof useList>;
} {
  const { db, me, serverMode } = useApp();

  const feed = useList(
    'notifications',
    { path: '/notifications/', frag: notificationsFragment },
    undefined,
    serverMode && !!me && enabled,
  );

  const rows = useMemo<Notification[]>(() => {
    if (!me) return [];
    if (serverMode) {
      const index = new Map(db.notifications.map(n => [n.id, n] as [string, Notification]));
      return feed.ids.map(id => index.get(id)).filter((n): n is Notification => !!n && n.uid === me.id);
    }
    return db.notifications.filter(n => n.uid === me.id).sort((a, b) => b.ts - a.ts);
  }, [db.notifications, feed.ids, me, serverMode]);

  return { rows, unread: rows.filter(n => !n.read).length, feed };
}
