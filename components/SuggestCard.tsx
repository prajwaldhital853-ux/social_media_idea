'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';

export default function SuggestCard() {
  const { db, me, isFollowing, toggleFollow } = useApp();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const suggestions = useMemo(() => {
    const followerCount = (id: string) => db.follows.filter(f => f.following === id).length;
    return db.users
      .filter(u => u.id !== me?.id && !isFollowing(u.id) && u.role === 'user')
      .sort((a, b) => Number(b.verified) - Number(a.verified) || followerCount(b.id) - followerCount(a.id))
      .slice(0, 6);
  }, [db.users, db.follows, me?.id, isFollowing]);

  if (!suggestions.length) return null;
  const shown = expanded ? suggestions : suggestions.slice(0, 3);

  return (
    <section className="suggest-card" aria-label="Suggested people">
      <div className="suggest-head">
        <h2>Fresh perspectives</h2>
        <p>New voices posting what you love.</p>
      </div>
      <ul className="suggest-list">
        {shown.map(u => (
          <li key={u.id} className="suggest-row">
            <Link href={`/u/${u.username}`} className="suggest-id">
              <Avatar user={u} size={44} />
              <span className="suggest-meta">
                <b>{u.name}{u.verified && <VerifiedBadge size={15} />}</b>
                <span>@{u.username}</span>
              </span>
            </Link>
            <button
              type="button"
              className="suggest-follow"
              onClick={() => (me ? toggleFollow(u.id) : router.push('/login'))}
            >
              {isFollowing(u.id) ? 'Following' : 'Follow'}
            </button>
          </li>
        ))}
      </ul>
      {suggestions.length > 3 && (
        <button type="button" className="suggest-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </section>
  );
}