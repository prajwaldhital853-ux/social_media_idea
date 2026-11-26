'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { usersFragment, useList } from '@/lib/lists';
import { localSuggestions } from '@/lib/suggest';
import { User } from '@/lib/types';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';

const GLANCE = 4;
const ROSTER = 30;

export default function SuggestCard() {
  const { db, me, followState, toggleFollow, t, serverMode } = useApp();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  // The server's own walk of the follow graph, so the rail says the same thing
  // as the See-all screen instead of re-ranking whoever is cached.
  const list = useList('suggested', { path: '/users/suggested/', frag: usersFragment }, { limit: ROSTER }, serverMode);

  const suggestions = useMemo<User[]>(() => {
    if (serverMode) {
      const index = new Map(db.users.map(u => [u.id, u] as [string, User]));
      return list.ids.map(id => index.get(id)).filter((u): u is User => !!u);
    }
    return localSuggestions(db, me?.id || null, ROSTER);
  }, [serverMode, list.ids, db, me?.id]);

  if (!suggestions.length) return null;
  const shown = expanded ? suggestions.slice(0, ROSTER) : suggestions.slice(0, GLANCE);

  return (
    <section className="suggest-rail" aria-label={t('suggestedForYou')}>
      <div className="suggest-rail-head">
        <h2>{t('suggestedForYou')}</h2>
        <Link href="/people">{t('seeAll')}</Link>
      </div>
      <ul className="suggest-list">
        {shown.map(u => {
          const state = followState(u.id);
          const followsMe = !!me && db.follows.some(f => f.follower === u.id && f.following === me.id && f.status !== 'pending');
          return (
            <li key={u.id} className="suggest-row">
              <Link href={`/u/${u.username}`} className="suggest-id">
                <Avatar user={u} size={40} />
                <span className="suggest-meta">
                  <b>{u.name}{u.verified && <VerifiedBadge size={15} />}</b>
                  <span>@{u.username}</span>
                </span>
              </Link>
              <button
                type="button"
                className={`suggest-follow ${state === 'following' ? 'on' : ''} ${state === 'pending' ? 'pending' : ''}`}
                onClick={() => (me ? toggleFollow(u.id) : router.push('/login'))}
              >
                {state === 'following' ? t('unfollow') : state === 'pending' ? t('requested') : followsMe ? t('followBack') : u.private ? t('requestFollow') : t('follow')}
              </button>
            </li>
          );
        })}
      </ul>
      {suggestions.length > GLANCE && (
        <button type="button" className="suggest-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? t('showLess') : t('showMore')}
        </button>
      )}
    </section>
  );
}
