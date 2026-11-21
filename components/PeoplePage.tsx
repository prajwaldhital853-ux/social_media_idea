'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import PeopleList from '@/components/PeopleList';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { User } from '@/lib/types';

export default function PeoplePage({ kind }: { kind: 'followers' | 'following' }) {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, incomingRequests, acceptRequest, declineRequest } = useApp();
  const username = String(params.username || '');
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());

  const people = useMemo<User[]>(() => {
    if (!user) return [];
    const edges = db.follows.filter(f =>
      (kind === 'followers' ? f.following === user.id : f.follower === user.id) && f.status !== 'pending'
    );
    return edges
      .map(f => db.users.find(u => u.id === (kind === 'followers' ? f.follower : f.following)))
      .filter((u): u is User => !!u)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db.follows, db.users, user, kind]);

  if (!user) {
    return (
      <AppShell>
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => router.push('/')}>{IC.back}</button>
          <h1>{kind === 'followers' ? t('followers') : t('followingCount')}</h1>
          <span className="detail-header-spacer" />
        </header>
        <div className="feed-empty profile-missing">
          <p>{t('noUser')}</p>
          <Link href="/explore">{t('search')}</Link>
        </div>
      </AppShell>
    );
  }

  const own = me?.id === user.id;
  const requests = own ? incomingRequests() : [];
  const title = kind === 'followers' ? t('followersOf', { name: user.name || user.username }) : t('followingOf', { name: user.name || user.username });

  return (
    <AppShell>
      <div className="people-page">
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => window.history.length > 1 ? router.back() : router.push(`/u/${user.username}`)}>{IC.back}</button>
          <h1>{title}</h1>
          <span className="detail-header-spacer" />
        </header>

        <Link href={`/u/${user.username}`} className="people-page-owner">
          <Avatar user={user} size={40} />
          <span>
            <b>{user.name || user.username}{user.verified && <VerifiedBadge size={14} />}</b>
            <small>@{user.username} · {people.length} {kind === 'followers' ? t('followers') : t('followingCount')}</small>
          </span>
        </Link>

        {own && kind === 'followers' && (
          <section className="people-requests" aria-label={t('followRequests')}>
            <h2>{IC.lock}{t('followRequests')}{requests.length > 0 && <em>{requests.length}</em>}</h2>
            {requests.length === 0 ? (
              <p className="people-requests-empty">{t('requestsEmpty')}</p>
            ) : (
              requests.map(f => {
                const u = db.users.find(x => x.id === f.follower);
                if (!u) return null;
                return (
                  <div className="people-row request" key={u.id}>
                    <Link href={`/u/${u.username}`} className="people-id">
                      <Avatar user={u} size={48} />
                      <span className="people-meta">
                        <b>{u.name || u.username}{u.verified && <VerifiedBadge size={14} />}</b>
                        <small>@{u.username}</small>
                      </span>
                    </Link>
                    <span className="request-actions">
                      <button type="button" className="follow-btn small" onClick={() => acceptRequest(u.id)}>{t('accept')}</button>
                      <button type="button" className="ghost-btn small" onClick={() => declineRequest(u.id)}>{t('decline')}</button>
                    </span>
                  </div>
                );
              })
            )}
          </section>
        )}

        <PeopleList people={people} empty={kind === 'followers' ? t('noFollowers') : t('noFollowing')} />
      </div>
    </AppShell>
  );
}