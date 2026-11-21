'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { ServerPaging, useWindowed } from '@/lib/useWindowed';
import { User } from '@/lib/types';

export default function PeopleList({ people, empty, server }: { people: User[]; empty: string; server?: ServerPaging }) {
  const router = useRouter();
  const { db, me, t, followState, toggleFollow } = useApp();
  // Keyed on the first row so a freshly loaded page appends instead of restarting the window.
  const { limit, pending, sentinel, hasMore } = useWindowed(people.length, 10, people[0]?.id || 'empty', server);

  if (people.length === 0 && server?.error) {
    return (
      <div className="feed-empty people-empty">
        <p>{server.error}</p>
        {server.retry && <button type="button" className="ghost-btn" onClick={() => void server.retry!()}>{t('retry')}</button>}
      </div>
    );
  }
  if (people.length === 0) {
    if (server && !server.loaded) {
      return (
        <div className="people-skeleton" aria-hidden="true">
          <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
        </div>
      );
    }
    return <p className="feed-empty people-empty">{empty}</p>;
  }

  return (
    <div className="people-page-list">
      {people.slice(0, limit).map(u => {
        const state = followState(u.id);
        const followsMe = !!me && db.follows.some(f => f.follower === u.id && f.following === me.id && f.status !== 'pending');
        return (
          <div className="people-row" key={u.id}>
            <Link href={`/u/${u.username}`} className="people-id">
              <Avatar user={u} size={48} />
              <span className="people-meta">
                <b>{u.name || u.username}{u.verified && <VerifiedBadge size={14} />}</b>
                <small>@{u.username}</small>
              </span>
            </Link>
            {me && u.id !== me.id && (
              <button
                type="button"
                className={`follow-btn small ${state === 'following' ? 'on' : ''} ${state === 'pending' ? 'pending' : ''}`}
                onClick={() => toggleFollow(u.id)}
              >
                {state === 'following' ? t('unfollow') : state === 'pending' ? t('requested') : followsMe ? t('followBack') : t('follow')}
              </button>
            )}
            {!me && (
              <button type="button" className="follow-btn small" onClick={() => router.push('/login')}>{t('follow')}</button>
            )}
          </div>
        );
      })}
      {pending && hasMore && (
        <div className="people-skeleton" aria-hidden="true">
          <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
        </div>
      )}
      {hasMore && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
    </div>
  );
}