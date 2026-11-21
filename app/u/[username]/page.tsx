'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import EditProfileModal from '@/components/EditProfileModal';
import { useApp } from '@/lib/AppContext';
import { listingsFragment, postsFragment, useList } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { canSeePost, hash, compact, ago } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { Listing, Post, User } from '@/lib/types';

const COVER_PALETTES = [
  ['#B63740', '#FDA041'],
  ['#1F6F78', '#B63740'],
  ['#4A3F8F', '#E40104'],
  ['#A85E00', '#B63740'],
  ['#2F6B4F', '#FDA041'],
  ['#2B3F47', '#B63740']
];

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, isFollowing, followState, toggleFollow, showToast, openComposer, serverMode, loadPerson } = useApp();
  const username = String(params.username || '');
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  const [tab, setTab] = useState<'posts' | 'media' | 'about' | 'listings'>('posts');
  const [editing, setEditing] = useState(false);
  // Only the profile row knows the true totals; a paginated list holds no more
  // than the rows the visitor has already scrolled past.
  const [stats, setStats] = useState<{ posts: number; followers: number; following: number } | null>(null);
  const [personRead, setPersonRead] = useState(!serverMode);

  const own = me?.id === user?.id;
  const locked = !!user?.private && !own && !isFollowing(user.id);

  const authorPosts = useList(
    'profile-posts',
    { path: '/posts/', frag: postsFragment(me?.id || null) },
    { author: username },
    serverMode && !!username,
  );
  const authorListings = useList(
    'profile-listings',
    { path: '/marketplace/', frag: listingsFragment },
    { seller: username },
    serverMode && !!username && !locked,
  );

  useEffect(() => {
    if (!serverMode || !username) return;
    let live = true;
    setPersonRead(false);
    loadPerson(username)
      .then(read => { if (live && read) setStats(read.stats); })
      .catch(() => {})
      .finally(() => { if (live) setPersonRead(true); });
    return () => { live = false; };
  }, [serverMode, username, loadPerson]);

  const cachedPosts = useMemo(() => {
    const index = new Map(db.posts.map(p => [p.id, p] as [string, Post]));
    return authorPosts.ids.map(id => index.get(id)).filter((p): p is Post => !!p);
  }, [db.posts, authorPosts.ids]);

  const posts = useMemo(() => {
    if (!user || locked) return [];
    if (serverMode) return cachedPosts;
    return db.posts
      .filter(p => p.uid === user.id && p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows))
      .sort((a, b) => b.ts - a.ts);
  }, [cachedPosts, db.posts, db.follows, user, me?.id, locked, serverMode]);
  const { limit: postLimit, pending: postsPending, sentinel: postsSentinel, hasMore: morePosts } = useWindowed(
    posts.length, 10, user?.id,
    serverMode ? { hasMore: authorPosts.hasMore, loading: authorPosts.loading, load: authorPosts.loadMore } : undefined,
  );

  if (!user) {
    return (
      <AppShell>
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => window.history.length > 1 ? router.back() : router.push('/')}>{IC.back}</button>
          <h1>{t('profile')}</h1>
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

  const following = isFollowing(user.id);
  const fState = followState(user.id);
  const followsMe = !!me && db.follows.some(f => f.follower === user.id && f.following === me.id && f.status !== 'pending');
  const suspended = !!user.susp && (user.susp.until === null || user.susp.until > Date.now());
  const followers = db.follows.filter(f => f.following === user.id && f.status !== 'pending').map(f => db.users.find(u => u.id === f.follower)).filter((u): u is User => !!u);
  const followingList = db.follows.filter(f => f.follower === user.id && f.status !== 'pending').map(f => db.users.find(u => u.id === f.following)).filter((u): u is User => !!u);
  const coverSrc = user.cover || (posts.flatMap(p => p.media.filter(m => m.type === 'image' && (m.src || m.gen)))[0]?.src || posts.flatMap(p => p.media.filter(m => m.type === 'image' && (m.src || m.gen)))[0]?.gen);
  const [ca, cb] = COVER_PALETTES[hash(user.id) % COVER_PALETTES.length];
  const joinedLabel = new Date(user.joined).toLocaleDateString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', { month: 'long', year: 'numeric' });
  const location = [user.city, user.province, user.country].filter(Boolean).join(', ');
  const mediaItems = posts.flatMap(p => p.media.map((m, index) => ({ m, index, post: p })));
  const userListings = serverMode
    ? authorListings.ids
        .map(id => db.listings.find(l => l.id === id))
        .filter((l): l is Listing => !!l)
    : db.listings
        .filter(l => l.uid === user.id && (own ? l.status !== 'removed' : l.status === 'active' || l.status === 'sold'))
        .sort((a, b) => b.ts - a.ts);
  const countPosts = stats ? stats.posts : posts.length;
  const countFollowers = stats ? stats.followers : followers.length;
  const countFollowing = stats ? stats.following : followingList.length;
  const tabKeys: ('posts' | 'media' | 'about' | 'listings')[] = userListings.length > 0 ? ['posts', 'media', 'listings', 'about'] : ['posts', 'media', 'about'];

  const openMedia = (postId: string, index: number, singleVideo: boolean) => {
    router.push(singleVideo ? `/video/${postId}-${index}` : `/post/${postId}/media/${index}`);
  };

  const shareProfile = async () => {
    const url = `${window.location.origin}/u/${user.username}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('linkCopied'));
    } catch {
      showToast(url);
    }
  };

  return (
    <AppShell>
      <div className="profile-view">
        <div className="profile-cover" style={!coverSrc ? { background: `linear-gradient(120deg, ${ca}, ${cb})` } : undefined}>
          {coverSrc && <img src={coverSrc} alt="" decoding="async" />}
          <div className="profile-cover-shade" />
          <button type="button" className="icon-btn profile-back" aria-label="Back" onClick={() => window.history.length > 1 ? router.back() : router.push('/')}>{IC.back}</button>
        </div>

        <div className="profile-head">
          <div className="profile-avatar"><Avatar user={user} size={112} /></div>
          <div className="profile-actions">
            {own ? (
              <>
                <button type="button" className="follow-btn" onClick={() => setEditing(true)}>{IC.user}<span>{t('editProfile')}</span></button>
                <button type="button" className="ghost-btn" onClick={() => openComposer(null)}>{IC.plus}<span>{t('post')}</span></button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`follow-btn ${following ? 'on' : ''} ${fState === 'pending' ? 'pending' : ''}`}
                  onClick={() => me ? toggleFollow(user.id) : router.push('/login')}
                >
                  {fState === 'following' ? t('unfollow') : fState === 'pending' ? t('requested') : user.private ? t('requestFollow') : followsMe ? t('followBack') : t('follow')}
                </button>
                <button type="button" className="ghost-btn" onClick={() => me ? router.push(`/messages/${user.username}`) : router.push('/login')}>
                  {IC.msg}<span>{t('message')}</span>
                </button>
              </>
            )}
            <button type="button" className="icon-btn" aria-label={t('share')} title={t('share')} onClick={() => void shareProfile()}>{IC.share}</button>
          </div>

          <h1 className="profile-name">
            {user.name || user.username}
            {user.verified && <VerifiedBadge size={20} />}
          </h1>
          <div className="profile-handle">
            @{user.username}
            {user.private && <span className="profile-private">{IC.lock}{t('privateAccount')}</span>}
          </div>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
          <div className="profile-meta">
            {location && <span className="profile-meta-chip">{IC.globe}{location}</span>}
            <span className="profile-meta-chip">{IC.calendar}{t('joined')} {joinedLabel}</span>
          </div>
          {suspended && <p className="profile-susp">{IC.flag}{t('suspNotice')} {user.susp?.reason}</p>}

          <div className="profile-stats">
            <span className="profile-stat"><b>{compact(countPosts)}</b> {t('postsCount')}</span>
            <Link href={`/u/${user.username}/followers`} className="profile-stat"><b>{compact(countFollowers)}</b> {t('followers')}</Link>
            <Link href={`/u/${user.username}/following`} className="profile-stat"><b>{compact(countFollowing)}</b> {t('followingCount')}</Link>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label={t('profile')}>
          {tabKeys.map(key => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {key === 'posts' ? t('postsCount') : key === 'media' ? t('media') : key === 'listings' ? t('listings') : t('about')}
            </button>
          ))}
        </div>

        {tab === 'posts' && (
          <div className="profile-posts">
            {locked ? (
              <div className="feed-empty profile-locked">{IC.lock}<p>{t('privateNotice')}</p></div>
            ) : suspended && !own ? (
              <p className="feed-empty">{t('suspNotice')}</p>
            ) : posts.length === 0 ? (
              <p className="feed-empty">{t('noPosts')}</p>
            ) : (
              <>
                {posts.slice(0, postLimit).map(post => <PostCard key={post.id} post={post} author={user} />)}
                {postsPending && morePosts && (
                  <div className="feed-skeleton" aria-hidden="true">
                    <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
                    <div className="sk-block" />
                  </div>
                )}
                {morePosts && <div ref={postsSentinel} className="feed-sentinel" aria-hidden="true" />}
              </>
            )}
          </div>
        )}

        {tab === 'listings' && (
          userListings.length === 0 ? (
            <p className="feed-empty">{t('noListings')}</p>
          ) : (
            <div className="market-grid profile-listings">
              {userListings.map(l => {
                const img = l.media.find(m => m.type === 'image' && m.src);
                return (
                  <Link href={`/marketplace/${l.id}`} key={l.id} className="market-card">
                    <span className="market-card-media">
                      {img ? <img src={img.src} alt={l.title} loading="lazy" /> : <span className="market-card-noimg">{IC.store}</span>}
                      {l.status === 'sold' && <span className="market-sold">{t('sold')}</span>}
                    </span>
                    <span className="market-card-body">
                      <b className="market-card-price">NPR {l.price.toLocaleString('en-US')}</b>
                      <span className="market-card-title">{l.title}</span>
                      <span className="market-card-loc">{IC.globe}{l.location} · {ago(l.ts, db.lang)}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )
        )}

        {tab === 'media' && (
          mediaItems.length === 0 ? (
            <p className="feed-empty">{t('noPosts')}</p>
          ) : (
            <div className="profile-media-grid">
              {mediaItems.map(({ m, index, post }) => (
                <button
                  type="button"
                  className="profile-media-cell"
                  key={`${post.id}-${index}`}
                  aria-label={`${m.type} by ${user.name}`}
                  onClick={() => openMedia(post.id, index, post.media.length === 1 && m.type === 'video')}
                >
                  {m.type === 'video' ? (
                    <>
                      <video src={m.src} muted preload="metadata" playsInline />
                      <span className="profile-media-play">{IC.video}</span>
                    </>
                  ) : (
                    <img src={m.src || m.gen} alt="" loading="lazy" decoding="async" />
                  )}
                </button>
              ))}
            </div>
          )
        )}

        {tab === 'about' && (
          <div className="profile-about">
            <div className="about-card about-bio">
              <h2>{IC.smile}{t('bio')}</h2>
              <p>{user.bio || t('noBio')}</p>
            </div>
            <div className="about-card">
              <h2>{IC.globe}{t('about')}</h2>
              <dl className="about-list">
                {location && <div><dt>{IC.globe}{t('city')}</dt><dd>{location}</dd></div>}
                <div><dt>{IC.calendar}{t('joined')}</dt><dd>{joinedLabel}</dd></div>
                {user.dob && <div><dt>{IC.calendar}{t('dob')}</dt><dd>{new Date(user.dob).toLocaleDateString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>}
                <div><dt>{IC.img}{t('postsCount')}</dt><dd>{posts.length}</dd></div>
                <div><dt>{IC.users}{t('followers')}</dt><dd>{countFollowers}</dd></div>
                <div><dt>{IC.users}{t('followingCount')}</dt><dd>{countFollowing}</dd></div>
              </dl>
            </div>
            {followingList.length > 0 && (
              <div className="about-card">
                <h2>{IC.users}{t('followsPeople')}</h2>
                <div className="about-follows">
                  {followingList.slice(0, 5).map(u => (
                    <Link key={u.id} href={`/u/${u.username}`} className="about-follow">
                      <Avatar user={u} size={44} />
                      <b>{u.name || u.username}</b>
                      <span>@{u.username}</span>
                    </Link>
                  ))}
                </div>
                <Link href={`/u/${user.username}/following`} className="about-more">{t('seeAllFollowing')}</Link>
              </div>
            )}
          </div>
        )}
      </div>

      {editing && own && <EditProfileModal onClose={() => setEditing(false)} />}
    </AppShell>
  );
}