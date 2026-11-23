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
 *
 * The row is not a single button: a follow notification also carries a
 * follow-back action on its right, and a button may not nest inside a button.
 */
export default function NotificationRow({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const { db, me, t, followState, requestFrom, followBack, toggleFollow } = useApp();
  const actor = n.actor ? db.users.find(u => u.id === n.actor) : undefined;
  const askedFor = n.kind === 'follow' && !!actor && !!me && actor.id !== me.id;
  const state = askedFor ? followState(actor!.id) : 'none';
  // Their request is still waiting, so this tap answers it instead of starting
  // a second one — a plain toggle would cancel my own standing request.
  const answer = askedFor && !!requestFrom(actor!.id) && state !== 'following';

  return (
    <div className={`notif-row ${n.read ? '' : 'unread'}`}>
      <button type="button" className="notif-open" onClick={() => onOpen(n)}>
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
      </button>
      {askedFor && (
        <button
          type="button"
          className={`notif-follow ${state === 'following' ? 'on' : !answer && state === 'pending' ? 'pending' : ''}`}
          onClick={() => void (answer ? followBack(actor!.id) : toggleFollow(actor!.id))}
        >
          {state === 'following' ? t('following') : answer ? t('followBack') : state === 'pending' ? t('requested') : t('followBack')}
        </button>
      )}
      {!n.read && <span className="notif-dot" aria-label={t('unread')} />}
    </div>
  );
}
