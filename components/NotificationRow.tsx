'use client';

import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { NOTIF_ICON } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { Notification } from '@/lib/types';

/**
 * One activity row, used by the notifications screen and the top-bar popover so
 * an unread dot, an actor badge and the kind icon never drift apart between them.
 */
export default function NotificationRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const { db, t } = useApp();
  const actor = n.actor ? db.users.find(u => u.id === n.actor) : undefined;

  return (
    <button type="button" className={`notif-row ${n.read ? '' : 'unread'}`} onClick={() => onOpen(n)}>
      <span className={`notif-icon kind-${n.kind}`}>
        {actor ? <Avatar user={actor} size={44} /> : NOTIF_ICON[n.kind]}
        {actor && <span className="notif-icon-badge">{NOTIF_ICON[n.kind]}</span>}
      </span>
      <span className="notif-main">
        <span className="notif-text">
          {actor && <b>{actor.name}{actor.verified && <VerifiedBadge />}</b>}
          {actor ? ' ' : ''}{n.text}
        </span>
        <span className={`notif-time ${n.read ? '' : 'fresh'}`}>{ago(n.ts, db.lang)}</span>
      </span>
      {!n.read && <span className="notif-dot" aria-label={t('unread')} />}
    </button>
  );
}
