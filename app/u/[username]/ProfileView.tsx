'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import NoticeBanner from '@/components/NoticeBanner';
import Avatar from '@/components/Avatar';
import VerifiedBadge from '@/components/VerifiedBadge';
import EditProfileModal from '@/components/EditProfileModal';
import ImageCropper from '@/components/ImageCropper';
import Lightbox from '@/components/Lightbox';
import { useApp } from '@/lib/AppContext';
import { listingsFragment, postsFragment, useList, usePull } from '@/lib/lists';
import { useWindowed } from '@/lib/useWindowed';
import { canSeePost, privateIds, compact, ago, safeUrl } from '@/lib/utils';
import { checkPhoto, profileImage } from '@/lib/mediaFile';
import { IC } from '@/lib/icons';
import { Listing, Post, User } from '@/lib/types';

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, t, isFollowing, followState, toggleFollow, showToast, serverMode, loadPerson, ready, updateProfile, openCreateChooser } = useApp();
  const username = String(params.username || '');
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  const [tab, setTab] = useState<'posts' | 'reels' | 'photos' | 'about' | 'listings'>('posts');
  const [reelOrder, setReelOrder] = useState<'views' | 'latest' | 'oldest'>('latest');
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);
  const [crop, setCrop] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef<HTMLInputElement>(null);
  // Only the profile row knows the true totals; a paginated list holds no more
  // than the rows the visitor has already scrolled past. They live in the
  // shared store, so a post this seat publishes or deletes from elsewhere moves
  // the card the moment it lands instead of waiting on a refresh.
  const stats = serverMode ? (db.personStats?.[username.toLowerCase()] ?? null) : null;
  const [personRead, setPersonRead] = useState(!serverMode);

  // The owner is the handle, not one id: a thin card that carries no id of its
  // own lands in the cache under a second key and would demote my own page to a
  // stranger's. Until the session is read nobody knows whose page this is, so
  // the row shows a placeholder rather than a button saying the wrong thing.
  const who = !!me || ready;
  const own = !!me && (me.id === user?.id || me.username.toLowerCase() === username.toLowerCase());
  const locked = !!user?.private && who && !own && !isFollowing(user.id);

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
  // The reels tab is a shelf of its own, and the server orders it: "most views"
  // over the rows this visitor happens to have scrolled past would be a sort of
  // a fragment, and the grid would change shape as the page loads more.
  const authorReels = useList(
    'profile-reels',
    { path: '/posts/', frag: postsFragment(me?.id || null) },
    { author: username, media: 'video', order: reelOrder === 'latest' ? undefined : reelOrder },
    serverMode && !!username && tab === 'reels',
  );
  const authorPhotos = useList(
    'profile-photos',
    { path: '/posts/', frag: postsFragment(me?.id || null) },
    { author: username, media: 'image' },
    serverMode && !!username && tab === 'photos' && !locked,
  );

  useEffect(() => {
    if (!serverMode || !username) return;
    let live = true;
    setPersonRead(false);
    loadPerson(username)
      .catch(() => {})
      .finally(() => { if (live) setPersonRead(true); });
    return () => { live = false; };
  }, [serverMode, username, loadPerson]);

  // The pull at the shell re-reads the one number no list carries: the author's
  // real totals, which a paginated page of posts can only ever understate.
  usePull(
    () => { void loadPerson(username); },
    serverMode && !!username,
  );

  const cachedPosts = useMemo(() => {
    const index = new Map(db.posts.map(p => [p.id, p] as [string, Post]));
    return authorPosts.ids.map(id => index.get(id)).filter((p): p is Post => !!p && p.status === 'live');
  }, [db.posts, authorPosts.ids]);

  const posts = useMemo(() => {
    if (!user || locked) return [];
    if (serverMode) return cachedPosts;
    return db.posts
      .filter(p => p.uid === user.id && p.status === 'live' && canSeePost(p, me?.id ?? null, db.follows, privateIds(db.users)))
      .sort((a, b) => b.ts - a.ts);
  }, [cachedPosts, db.posts, db.follows, user, me?.id, locked, serverMode]);
  const cachedPhotos = useMemo(() => {
    const index = new Map(db.posts.map(p => [p.id, p] as [string, Post]));
    const rows = serverMode
      ? authorPhotos.ids.map(id => index.get(id)).filter((p): p is Post => !!p && p.status === 'live')
      : posts;
    return rows.flatMap(p => (p.media || [])
      .map((m, i) => ({ m, index: i, post: p }))
      .filter(cell => cell.m.type === 'image'));
  }, [authorPhotos.ids, db.posts, posts, serverMode]);
  const photoCells = locked ? [] : cachedPhotos;
  // One cell per moving picture this author owns, in the order the reader picked.
  // Only the demo build sorts: its rows arrive in one order and the words are the
  // reader's, so the shelf has to re-lay them. The server build must not, because
  // its paginator breaks a tie its own way — equal tallies oldest-first — and a
  // second sort here would scramble what the cursor was built on.
  const reelCells = useMemo(() => {
    const index = new Map(db.posts.map(p => [p.id, p] as [string, Post]));
    const rows = serverMode
      ? authorReels.ids.map(id => index.get(id)).filter((p): p is Post => !!p && p.status === 'live')
      : user ? db.posts.filter(p => p.uid === user.id && p.status === 'live'
          && canSeePost(p, me?.id ?? null, db.follows, privateIds(db.users))) : [];
    const cells = rows.flatMap(p => (p.media || [])
      .map((m, i) => ({ m, index: i, post: p }))
      .filter(c => c.m.type === 'video'));
    return serverMode ? cells : cells.sort((a, b) => (reelOrder === 'views'
      ? (b.post.views ?? 0) - (a.post.views ?? 0) || b.post.ts - a.post.ts
      : reelOrder === 'oldest' ? a.post.ts - b.post.ts : b.post.ts - a.post.ts));
  }, [authorReels.ids, db.posts, db.follows, me?.id, user, reelOrder, serverMode]);
  const visibleReels = locked ? [] : reelCells;
  const { limit: postLimit, pending: postsPending, sentinel: postsSentinel, hasMore: morePosts } = useWindowed(
    posts.length, 10, user?.id,
    serverMode ? { hasMore: authorPosts.hasMore, loading: authorPosts.loading, load: authorPosts.loadMore } : undefined,
  );
  // The reels grid pages on its own list rather than on the posts the reader has
  // scrolled past, so an author with a hundred reels is not cut off at page one.
  const { limit: reelLimit, pending: reelsPending, sentinel: reelsSentinel, hasMore: moreReels } = useWindowed(
    visibleReels.length, 12, `${username}:${reelOrder}`,
    serverMode ? { hasMore: authorReels.hasMore, loading: authorReels.loading, load: authorReels.loadMore } : undefined,
  );
  const { limit: photoLimit, pending: photosPending, sentinel: photosSentinel, hasMore: morePhotos } = useWindowed(
    photoCells.length, 12, `${username}:photos`,
    serverMode ? { hasMore: authorPhotos.hasMore, loading: authorPhotos.loading, load: authorPhotos.loadMore } : undefined,
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
  // A missing cover stays missing: falling back to the author's first picture made
  // a profile look like it had a banner the owner never chose.
  const coverSrc = user.cover || '';
  const joinedLabel = new Date(user.joined).toLocaleDateString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', { month: 'long', year: 'numeric' });
  const location = [user.city, user.province, user.country].filter(Boolean).join(', ');
  const phoneUrl = user.phone ? `tel:${user.phone.replace(/[^\d+]/g, '')}` : null;
  const websiteUrl = safeUrl(user.website);
  // A stored url can only have come through the serializer's http(s) check, but
  // demo data is editable straight from localStorage, so render re-validates.
  const aboutLinks = (user.links || []).map(l => ({ ...l, url: safeUrl(l.url) })).filter((l): l is { label: string; url: string } => !!l.url);
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
  const tabKeys: ('posts' | 'reels' | 'photos' | 'about' | 'listings')[] = userListings.length > 0
    ? ['posts', 'reels', 'photos', 'listings', 'about']
    : ['posts', 'reels', 'photos', 'about'];

  const openMedia = (postId: string, index: number, singleVideo: boolean) => {
    router.push(singleVideo ? `/video/${postId}-${index}` : `/post/${postId}/media/${index}`);
  };

  // A hard load paints this card a beat before the session finishes restoring,
  // and a fast tap must not bounce a signed-in reader to the sign-in screen.
  const needSession = (run: () => void) => {
    if (me) { run(); return; }
    if (ready) router.push('/login');
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

  const pickCover = (file: File | undefined) => {
    if (!file) return;
    try {
      checkPhoto(file);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'That image could not be read. Try another one.');
      return;
    }
    setCrop(URL.createObjectURL(file));
  };

  // The banner is framed by the author, not by whatever the first post happened to
  // carry: pick, crop on the device, and only then send the bytes.
  const useCover = async (file: File) => {
    if (crop) URL.revokeObjectURL(crop);
    setCrop(null);
    setCoverBusy(true);
    try {
      await updateProfile({ cover: await profileImage(file, 1600) });
      showToast(t('profileUpdated'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Your cover could not be saved.');
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="profile-view">
        <div className="profile-cover">
          {coverSrc ? (
            <>
              <img src={coverSrc} alt="" decoding="async" />
              <div className="profile-cover-shade" />
              <button
                type="button"
                className="profile-cover-open"
                aria-label={t('viewCover')}
                onClick={() => setZoom({ src: coverSrc, caption: `${user.name || user.username} · ${t('viewCover')}` })}
              />
            </>
          ) : (
            own && (
              <button type="button" className="profile-cover-upload" disabled={coverBusy} onClick={() => coverRef.current?.click()}>
                {IC.img}
                <span>{t('uploadCover')}</span>
              </button>
            )
          )}
          {own && (
            <input
              ref={coverRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={e => { pickCover(e.target.files?.[0]); e.target.value = ''; }}
            />
          )}
          <button type="button" className="icon-btn profile-back" aria-label="Back" onClick={() => window.history.length > 1 ? router.back() : router.push('/')}>{IC.back}</button>
        </div>

        <div className="profile-head">
          <div className="profile-avatar">
            {user.avatar ? (
              <button
                type="button"
                className="profile-avatar-open"
                aria-label={t('viewPhoto')}
                onClick={() => setZoom({ src: user.avatar!, caption: `${user.name || user.username} · ${t('viewPhoto')}` })}
              >
                <Avatar user={user} size={112} />
              </button>
            ) : (
              <Avatar user={user} size={112} />
            )}
          </div>
          <div className="profile-actions">
            {own ? (
              <>
                <button type="button" className="follow-btn" onClick={() => setEditing(true)}>{IC.user}<span>{t('editProfile')}</span></button>
                <button type="button" className="ghost-btn" onClick={() => needSession(openCreateChooser)}>{IC.plus}<span>{t('post')}</span></button>
              </>
            ) : !who ? (
              <span className="profile-actions-wait" aria-hidden="true" />
            ) : (
              <>
                <button
                  type="button"
                  className={`follow-btn ${following ? 'on' : ''} ${fState === 'pending' ? 'pending' : ''}`}
                  onClick={() => needSession(() => { void toggleFollow(user.id); })}
                >
                  {fState === 'following' ? t('unfollow') : fState === 'pending' ? t('requested') : user.private ? t('requestFollow') : followsMe ? t('followBack') : t('follow')}
                </button>
                <button type="button" className="ghost-btn" onClick={() => needSession(() => router.push(`/messages/${user.username}`))}>
                  {IC.msg}<span>{t('message')}</span>
                </button>
              </>
            )}
            {own && (
              <button type="button" className="icon-btn" aria-label={t('saved')} title={t('saved')} onClick={() => router.push('/saved')}>
                {IC.bookmark}
              </button>
            )}
            <button type="button" className="icon-btn" aria-label={t('share')} title={t('share')} onClick={() => void shareProfile()}>{IC.share}</button>
          </div>

          <NoticeBanner notices={user.notices} full/>

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
            <button
              type="button"
              className="profile-stat"
              onClick={() => {
                setTab('posts');
                document.querySelector('.profile-posts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            ><b>{compact(countPosts)}</b> {t('postsCount')}</button>
            <Link href={`/u/${user.username}/followers`} className="profile-stat"><b>{compact(countFollowers)}</b> {t('followers')}</Link>
            <Link href={`/u/${user.username}/following`} className="profile-stat following-stat"><b>{compact(countFollowing)}</b> {t('followingCount')}</Link>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label={t('profile')}>
          {tabKeys.map(key => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {key === 'posts' ? t('postsCount') : key === 'reels' ? t('reels') : key === 'photos' ? t('photos') : key === 'listings' ? t('listings') : t('about')}
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
              // The row above already knows the author's total; until this page's
              // first rows land, saying "no posts" would contradict it.
              serverMode && !authorPosts.loaded ? (
                <div className="feed-skeleton" aria-hidden="true">
                  <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
                  <div className="sk-block" />
                </div>
              ) : (
                <p className="feed-empty">{t('noPosts')}</p>
              )
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

        {tab === 'reels' && (
          visibleReels.length === 0 ? (
            locked ? (
              <div className="feed-empty profile-locked">{IC.lock}<p>{t('privateNotice')}</p></div>
            ) : serverMode && !authorReels.loaded ? (
              <div className="profile-media-grid" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map(i => <div className="sk-block profile-reel-sk" key={i} />)}
              </div>
            ) : (
              <p className="feed-empty">{t('noPosts')}</p>
            )
          ) : (
            <>
              <div className="profile-reel-sort" role="group" aria-label={t('sortReels')}>
                {([['views', t('mostViewed')], ['latest', t('latest')], ['oldest', t('oldest')]] as ['views' | 'latest' | 'oldest', string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={reelOrder === key ? 'on' : ''}
                    aria-pressed={reelOrder === key}
                    onClick={() => setReelOrder(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="profile-media-grid">
                {visibleReels.slice(0, reelLimit).map(({ m, index, post }) => (
                  <button
                    type="button"
                    className="profile-media-cell reel-cell"
                    key={`${post.id}-${index}`}
                    aria-label={`${t('reels')} by ${user.name}`}
                    onClick={() => openMedia(post.id, index, post.media.length === 1)}
                  >
                    <video src={m.src} muted preload="metadata" playsInline />
                    <span className="profile-media-play">{IC.video}</span>
                    {(post.views ?? 0) > 0 && <span className="profile-cell-views">{compact(post.views ?? 0)}</span>}
                  </button>
                ))}
              </div>
              {reelsPending && moreReels && (
                <div className="profile-media-grid" aria-hidden="true">
                  {[0, 1, 2, 3].map(i => <div className="sk-block profile-reel-sk" key={i} />)}
                </div>
              )}
              {moreReels && <div ref={reelsSentinel} className="feed-sentinel" aria-hidden="true" />}
            </>
          )
        )}

        {tab === 'photos' && (
          photoCells.length === 0 ? (
            locked ? (
              <div className="feed-empty profile-locked">{IC.lock}<p>{t('privateNotice')}</p></div>
            ) : serverMode && !authorPhotos.loaded ? (
              <div className="profile-media-grid" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map(i => <div className="sk-block profile-reel-sk" key={i} />)}
              </div>
            ) : (
              <p className="feed-empty">{t('noPosts')}</p>
            )
          ) : (
            <>
              <div className="profile-media-grid photo-grid">
                {photoCells.slice(0, photoLimit).map(({ m, index, post }) => (
                  <button
                    type="button"
                    className="profile-media-cell"
                    key={`${post.id}-${index}`}
                    aria-label={`${t('photos')} by ${user.name}`}
                    onClick={() => openMedia(post.id, index, false)}
                  >
                    <img src={m.src || m.gen} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
              {photosPending && morePhotos && (
                <div className="profile-media-grid" aria-hidden="true">
                  {[0, 1, 2, 3].map(i => <div className="sk-block profile-reel-sk" key={i} />)}
                </div>
              )}
              {morePhotos && <div ref={photosSentinel} className="feed-sentinel" aria-hidden="true" />}
            </>
          )
        )}

        {tab === 'about' && (
          <div className="profile-about">
            <div className="about-card about-bio">
              <h2>{IC.smile}{t('bio')}</h2>
              <p>{user.bio || t('noBio')}</p>
            </div>
            <div className="about-card">
              <h2>{IC.calendar}{t('aboutBasic')}</h2>
              <dl className="about-list">
                {location && <div><dt>{IC.globe}{t('city')}</dt><dd>{location}</dd></div>}
                <div><dt>{IC.calendar}{t('joined')}</dt><dd>{joinedLabel}</dd></div>
                {user.dob && <div><dt>{IC.smile}{t('dob')}</dt><dd>{new Date(user.dob).toLocaleDateString(db.lang === 'ne' ? 'ne-NP' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>}
              </dl>
            </div>
            {(phoneUrl || websiteUrl) && (
              <div className="about-card">
                <h2>{IC.phone}{t('aboutContact')}</h2>
                <dl className="about-list">
                  {phoneUrl && (
                    <div>
                      <dt>{IC.phone}{t('phone')}</dt>
                      <dd><a className="about-link" href={phoneUrl}>{user.phone}</a></dd>
                    </div>
                  )}
                  {websiteUrl && (
                    <div>
                      <dt>{IC.globe}{t('website')}</dt>
                      <dd><a className="about-link" href={websiteUrl} target="_blank" rel="noopener noreferrer">{websiteUrl.replace(/^https?:\/\//, '')}</a></dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
            {aboutLinks.length > 0 && (
              <div className="about-card">
                <h2>{IC.link}{t('aboutLinksTitle')}</h2>
                <dl className="about-list">
                  {aboutLinks.map(l => (
                    <div key={l.url}>
                      <dt>{IC.link}{l.label}</dt>
                      <dd><a className="about-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.url.replace(/^https?:\/\//, '')}</a></dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className="about-card about-stats">
              <div className="about-stat">
                <b>{posts.length}</b>
                <span>{t('postsCount')}</span>
              </div>
              <div className="about-stat">
                <b>{countFollowers}</b>
                <span>{t('followers')}</span>
              </div>
              <div className="about-stat">
                <b>{countFollowing}</b>
                <span>{t('followingCount')}</span>
              </div>
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
      {zoom && <Lightbox src={zoom.src} caption={zoom.caption} onClose={() => setZoom(null)} />}
      {crop && (
        <ImageCropper
          src={crop}
          name="cover.jpg"
          max={1600}
          onCancel={() => { URL.revokeObjectURL(crop); setCrop(null); }}
          onCrop={file => { void useCover(file); }}
        />
      )}
    </AppShell>
  );
}