'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import PeopleList from '@/components/PeopleList';
import { useApp } from '@/lib/AppContext';
import { usersFragment, useList, usePull } from '@/lib/lists';
import { IC } from '@/lib/icons';
import { goBack } from '@/lib/navStack';
import { User } from '@/lib/types';

export default function PeoplePage({ kind }: { kind: 'followers' | 'following' }) {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, incomingRequests, acceptRequest, declineRequest, removeFollower, serverMode, loadPerson } = useApp();
  const username = String(params.username || '');
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  const [profile, setProfile] = useState<{ followers: number; following: number; locked: boolean } | null>(null);
  const [personRead, setPersonRead] = useState(!serverMode);

  // The circle is the server's page, in the server's order: newest edge first,
  // ten at a time, cursor and all — nothing here re-sorts it.
  const circle = useList(
    `circle:${username.toLowerCase()}:${kind}`,
    { path: `/users/${username}/${kind}/`, frag: usersFragment },
    undefined,
    serverMode && !!username,
  );

  useEffect(() => {
    if (!serverMode || !username) return;
    let live = true;
    setPersonRead(false);
    loadPerson(username)
      .then(read => {
        if (!live || !read) return;
        setProfile({ followers: read.stats.followers, following: read.stats.following, locked: read.locked });
      })
      .catch(() => {})
      .finally(() => { if (live) setPersonRead(true); });
    return () => { live = false; };
  }, [serverMode, username, loadPerson]);

  // The pull at the shell re-reads the circle's own totals, which no page of the
  // list can answer: the list holds rows, the profile row holds the count.
  usePull(() => loadPerson(username).then(read => {
    if (!read) return;
    setProfile({ followers: read.stats.followers, following: read.stats.following, locked: read.locked });
  }), serverMode && !!username);

  const people = useMemo<User[]>(() => {
    if (!user) return [];
    if (serverMode) {
      const index = new Map(db.users.map(u => [u.id, u] as [string, User]));
      return circle.ids.map(id => index.get(id)).filter((u): u is User => !!u);
    }
    const edges = db.follows.filter(f =>
      (kind === 'followers' ? f.following === user.id : f.follower === user.id) && f.status !== 'pending'
    );
    return edges
      .map(f => db.users.find(u => u.id === (kind === 'followers' ? f.follower : f.following)))
      .filter((u): u is User => !!u)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [circle.ids, db.follows, db.users, serverMode, user, kind]);

  if (!user) {
    return (
      <AppShell>
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => router.push('/')}>{IC.back}</button>
          <h1>{kind === 'followers' ? t('followers') : t('followingCount')}</h1>
          <span className="detail-header-spacer" />
        </header>
        {!personRead ? (
          <div className="feed-skeleton profile-skeleton" aria-hidden="true">
            <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
            <div className="sk-lines wide"><i /><i /></div>
          </div>
        ) : (
          <div className="feed-empty profile-missing">
            <p>{t('noUser')}</p>
            <Link href="/explore">{t('search')}</Link>
          </div>
        )}
      </AppShell>
    );
  }

  const own = !!me && (me.id === user.id || me.username.toLowerCase() === username.toLowerCase());
  const requests = own ? incomingRequests() : [];
  const title = kind === 'followers' ? t('followersOf', { name: user.name || user.username }) : t('followingOf', { name: user.name || user.username });
  const total = profile ? (kind === 'followers' ? profile.followers : profile.following) : people.length;
  // A private account answers an empty circle to strangers, so say whose it is
  // instead of claiming nobody is there. The owner is never a stranger: an
  // empty circle under their own name is genuinely empty, not locked.
  const hidden = !!profile?.locked && !own;
  const emptyText = hidden ? t('privateNotice') : (kind === 'followers' ? t('noFollowers') : t('noFollowing'));

  // An answer moves a real edge, so the page re-reads the circle and the totals
  // rather than trusting the one row it just changed.
  const settle = async () => {
    if (!serverMode) return;
    await circle.reload();
    const read = await loadPerson(username).catch(() => null);
    if (read) setProfile({ followers: read.stats.followers, following: read.stats.following, locked: read.locked });
  };
  const answer = async (id: string, yes: boolean) => {
    if (yes) await acceptRequest(id); else await declineRequest(id);
    await settle();
  };
  const dropFollower = async (id: string) => {
    await removeFollower(id);
    await settle();
  };

  return (
    <AppShell>
      <div className="people-page">
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label={t('back')} onClick={() => goBack(router, `/u/${user.username}`)}>{IC.back}</button>
          <h1>{title}</h1>
          <span className="detail-header-spacer" />
        </header>

        <Link href={`/u/${user.username}`} className="people-page-owner">
          <Avatar user={user} size={40} />
          <span>
            <b>{user.name || user.username}{user.verified && <VerifiedBadge size={14} />}</b>
            <small>@{user.username} · {total} {kind === 'followers' ? t('followers') : t('followingCount')}</small>
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
                      <button type="button" className="follow-btn small" onClick={() => void answer(u.id, true)}>{t('confirm')}</button>
                      <button type="button" className="ghost-btn small" onClick={() => void answer(u.id, false)}>{t('delete')}</button>
                    </span>
                  </div>
                );
              })
            )}
          </section>
        )}

        <PeopleList
          people={people}
          empty={emptyText}
          onRemove={own && kind === 'followers' ? dropFollower : undefined}
          server={serverMode ? {
            hasMore: circle.hasMore,
            loading: circle.loading,
            load: circle.loadMore,
            loaded: circle.loaded,
            error: circle.error,
            retry: circle.reload,
          } : undefined}
        />
      </div>
    </AppShell>
  );
}