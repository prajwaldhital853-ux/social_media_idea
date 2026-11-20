'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import EditProfileModal from '@/components/EditProfileModal';
import { useApp } from '@/lib/AppContext';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';
import { canSeePost, hash, compact } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { User } from '@/lib/types';

const COVER_PALETTES = [
  ['#B63740', '#FDA041'],
  ['#1F6F78', '#B63740'],
  ['#4A3F8F', '#E40104'],
  ['#A85E00', '#B63740'],
  ['#2F6B4F', '#FDA041'],
  ['#2B3F47', '#B63740']
];

function PeopleModal({ title, people, onClose }: { title: string; people: User[]; onClose: () => void }) {
  const { me, t, isFollowing, toggleFollow } = useApp();
  const router = useRouter();
  useBackClose(true, onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content people-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-header">
          <b>{title}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="people-list">
          {people.length === 0 && <p className="feed-empty">{title === t('followers') ? t('noFollowers') : t('noFollowing')}</p>}
          {people.map(u => (
            <div className="people-row" key={u.id}>
              <Link href={`/u/${u.username}`} className="people-id" onClick={() => { closeLayerWithoutBack(); onClose(); }}>
                <Avatar user={u} size={44} />
                <span className="people-meta">
                  <b>{u.name || u.username}{u.verified && <VerifiedBadge size={14} />}</b>
                  <small>@{u.username}</small>
                </span>
              </Link>
              {me && u.id !== me.id && (
                <button
                  type="button"
                  className={`follow-btn small ${isFollowing(u.id) ? 'on' : ''}`}
                  onClick={() => toggleFollow(u.id)}
                >
                  {isFollowing(u.id) ? t('unfollow') : t('follow')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, isFollowing, toggleFollow, showToast } = useApp();
  const username = String(params.username || '');
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  const [tab, setTab] = useState<'posts' | 'media' | 'about'>('posts');
  const [editing, setEditing] = useState(false);
  const [people, setPeople] = useState<'followers' | 'following' | null>(null);

  const posts = useMemo(() => {
    if (!user) return [];
    return db.posts
      .filter(p => p.uid === user.id && p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows))
      .sort((a, b) => b.ts - a.ts);
  }, [db.posts, db.follows, user, me?.id]);

  if (!user) {
    return (
      <AppShell>
        <header className="detail-header">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => window.history.length > 1 ? router.back() : router.push('/')}>{IC.back}</button>
          <h1>{t('profile')}</h1>
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
  const following = isFollowing(user.id);
  const suspended = !!user.susp && (user.susp.until === null || user.susp.until > Date.now());
  const followers = db.follows.filter(f => f.following === user.id).map(f => db.users.find(u => u.id === f.follower)).filter((u): u is User => !!u);
  const followingList = db.follows.filter(f => f.follower === user.id).map(f => db.users.find(u => u.id === f.following)).filter((u): u is User => !!u);
  const coverMedia = posts.flatMap(p => p.media.filter(m => m.type === 'image' && (m.src || m.gen)))[0];
  const [ca, cb] = COVER_PALETTES[hash(user.id) % COVER_PALETTES.length];
  const joinedLabel = new Date(user.joined).toLocaleDateString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', { month: 'long', year: 'numeric' });
  const location = [user.city, user.province, user.country].filter(Boolean).join(', ');
  const mediaItems = posts.flatMap(p => p.media.map((m, index) => ({ m, index, post: p })));

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
        <div className="profile-cover" style={!coverMedia ? { background: `linear-gradient(120deg, ${ca}, ${cb})` } : undefined}>
          {coverMedia && <img src={coverMedia.src || coverMedia.gen} alt="" decoding="async" />}
          <div className="profile-cover-shade" />
          <button type="button" className="icon-btn profile-back" aria-label="Back" onClick={() => window.history.length > 1 ? router.back() : router.push('/')}>{IC.back}</button>
        </div>

        <div className="profile-head">
          <div className="profile-avatar"><Avatar user={user} size={112} /></div>
          <div className="profile-actions">
            {own ? (
              <button type="button" className="follow-btn" onClick={() => setEditing(true)}>{IC.user}<span>{t('editProfile')}</span></button>
            ) : (
              <>
                <button
                  type="button"
                  className={`follow-btn ${following ? 'on' : ''}`}
                  onClick={() => me ? toggleFollow(user.id) : router.push('/login')}
                >
                  {following ? t('unfollow') : t('follow')}
                </button>
                <button type="button" className="ghost-btn" onClick={() => me ? router.push(`/messages/${user.id}`) : router.push('/login')}>
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
          <div className="profile-handle">@{user.username}</div>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
          <div className="profile-meta">
            {location && <span className="profile-meta-chip">{IC.globe}{location}</span>}
            <span className="profile-meta-chip">{IC.calendar}{t('joined')} {joinedLabel}</span>
          </div>
          {suspended && <p className="profile-susp">{IC.flag}{t('suspNotice')} {user.susp?.reason}</p>}

          <div className="profile-stats">
            <span className="profile-stat"><b>{compact(posts.length)}</b> {t('postsCount')}</span>
            <button type="button" className="profile-stat" onClick={() => setPeople('followers')}><b>{compact(followers.length)}</b> {t('followers')}</button>
            <button type="button" className="profile-stat" onClick={() => setPeople('following')}><b>{compact(followingList.length)}</b> {t('followingCount')}</button>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label={t('profile')}>
          {(['posts', 'media', 'about'] as const).map(key => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {key === 'posts' ? t('postsCount') : key === 'media' ? t('media') : t('about')}
            </button>
          ))}
        </div>

        {tab === 'posts' && (
          <div className="profile-posts">
            {suspended && !own ? (
              <p className="feed-empty">{t('suspNotice')}</p>
            ) : posts.length === 0 ? (
              <p className="feed-empty">{t('noPosts')}</p>
            ) : (
              posts.map(post => <PostCard key={post.id} post={post} author={user} />)
            )}
          </div>
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
            <div className="about-card">
              <h2>{t('bio')}</h2>
              <p>{user.bio || '—'}</p>
            </div>
            <div className="about-card">
              <h2>{t('about')}</h2>
              <dl className="about-list">
                {location && <div><dt>{t('city')}</dt><dd>{location}</dd></div>}
                <div><dt>{t('joined')}</dt><dd>{joinedLabel}</dd></div>
                <div><dt>{t('postsCount')}</dt><dd>{posts.length}</dd></div>
                <div><dt>{t('followers')}</dt><dd>{followers.length}</dd></div>
                <div><dt>{t('followingCount')}</dt><dd>{followingList.length}</dd></div>
              </dl>
            </div>
          </div>
        )}
      </div>

      {editing && own && <EditProfileModal onClose={() => setEditing(false)} />}
      {people && (
        <PeopleModal
          title={people === 'followers' ? t('followers') : t('followingCount')}
          people={people === 'followers' ? followers : followingList}
          onClose={() => setPeople(null)}
        />
      )}
    </AppShell>
  );
}