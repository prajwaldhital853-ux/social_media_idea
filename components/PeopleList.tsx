'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { useWindowed } from '@/lib/useWindowed';
import { User } from '@/lib/types';

export default function PeopleList({ people, empty }: { people: User[]; empty: string }) {
  const router = useRouter();
  const { db, me, t, followState, toggleFollow } = useApp();
  const { limit, pending, sentinel, hasMore } = useWindowed(people.length, 10, people.length);

  if (people.length === 0) return <p className="feed-empty people-empty">{empty}</p>;

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