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
  const { db, me, t, followState, requestFrom, toggleFollow, acceptRequest, declineRequest } = useApp();
  const actor = n.actor ? db.users.find(u => u.id === n.actor) : undefined;
  const askedFor = n.kind === 'follow' && !!actor && !!me && actor.id !== me.id;
  const state = askedFor ? followState(actor!.id) : 'none';
  // The row answers the request that is actually standing, not the wording of
  // the note: confirm or delete it here. Follow back only appears afterwards.
  const waiting = askedFor ? requestFrom(actor!.id) : null;
  const followsMe = askedFor && db.follows.some(f => f.follower === actor!.id && f.following === me!.id && f.status !== 'pending');

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
      {waiting ? (
        <span className="request-actions">
          <button type="button" className="follow-btn small" onClick={() => void acceptRequest(actor!.id)}>{t('confirm')}</button>
          <button type="button" className="ghost-btn small" onClick={() => void declineRequest(actor!.id)}>{t('delete')}</button>
        </span>
      ) : askedFor && (
        <button
          type="button"
          className={`notif-follow ${state === 'following' ? 'on' : state === 'pending' ? 'pending' : ''}`}
          onClick={() => void toggleFollow(actor!.id)}
        >
          {state === 'following' ? t('following') : state === 'pending' ? t('requested') : followsMe ? t('followBack') : t('follow')}
        </button>
      )}
      {!n.read && <span className="notif-dot" aria-label={t('unread')} />}
    </div>
  );
}
